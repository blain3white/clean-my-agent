import { type CSSProperties, useMemo, useState } from 'react'
import CodexIcon from '@lobehub/icons/es/Codex'
import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode'
import CursorIcon from '@lobehub/icons/es/Cursor'
import GeminiIcon from '@lobehub/icons/es/Gemini'
import OpenCodeIcon from '@lobehub/icons/es/OpenCode'
import {
  Activity,
  Archive,
  ArrowRightLeft,
  BarChart3,
  Bot,
  ChartNoAxesColumn,
  ChartSpline,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  Download,
  FileJson2,
  Gauge,
  Grid3X3,
  HardDrive,
  HeartPulse,
  LayoutDashboard,
  ListFilter,
  Loader2,
  Moon,
  Pin,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Toaster } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useDashboard } from '@/hooks/use-dashboard'
import { useTheme } from '@/hooks/use-theme'
import { agentLabel, formatBytes, formatRelative, formatTokens, riskAccent } from '@/lib/format'
import { agentSources, type AgentSource, type CleanupCandidate, type DashboardSnapshot, type SessionRecord, type UsagePoint } from '@/shared/types'
import './App.css'

type ViewId = 'overview' | 'sessions' | 'cleanup' | 'usage' | 'relay' | 'health' | 'settings'
type AgentLogoStyle = CSSProperties & { '--agent-color': string }
type UsageRange = 7 | 14 | 30
type TokenActivityMode = 'line' | 'bar' | 'heat'
type StorageViewMode = 'layout' | 'list' | 'pie'
type ChartTooltipPayload = {
  dataKey?: string
  value?: unknown
  payload?: UsagePoint
}
type StorageDatum = {
  name: string
  value: number
  source: AgentSource
  sessions: number
}
type HeatmapCell = {
  date: string
  day: string
  value: number
  level: number
  week: number
  gridColumn: number
  gridRow: number
}

const navItems: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: Database },
  { id: 'cleanup', label: 'Cleanup', icon: Trash2 },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'relay', label: 'Relay JSON', icon: ArrowRightLeft },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const sourceColors: Record<AgentSource, string> = {
  codex: '#a78bfa',
  claude: '#fb923c',
  cursor: '#cbd5e1',
  gemini: '#38bdf8',
  opencode: '#60a5fa',
}

const sourceIconColors: Record<AgentSource, string> = {
  ...sourceColors,
  cursor: '#f8fafc',
  opencode: '#f8fafc',
}

const usageRanges: Array<{ value: UsageRange; label: string }> = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
]

const tokenActivityModes: Array<{ value: TokenActivityMode; label: string; icon: typeof ChartSpline }> = [
  { value: 'line', label: 'Linear', icon: ChartSpline },
  { value: 'bar', label: 'Bar', icon: ChartNoAxesColumn },
  { value: 'heat', label: 'Heatmap', icon: Grid3X3 },
]

const storageViewModes: Array<{ value: StorageViewMode; label: string; icon: typeof Grid3X3 }> = [
  { value: 'layout', label: 'Layout', icon: Grid3X3 },
  { value: 'list', label: 'List', icon: ListFilter },
  { value: 'pie', label: 'Pie', icon: Circle },
]

function AgentGlyph({ source }: { source: AgentSource }) {
  const iconProps = { size: 16 }
  const icon = {
    codex: <CodexIcon {...iconProps} />,
    claude: <ClaudeCodeIcon {...iconProps} />,
    cursor: <CursorIcon {...iconProps} />,
    gemini: <GeminiIcon {...iconProps} />,
    opencode: <OpenCodeIcon {...iconProps} />,
  }[source]

  return (
    <span
      className="agent-logo grid size-8 place-items-center"
      data-source={source}
      style={{ '--agent-color': sourceColors[source], color: sourceIconColors[source] } as AgentLogoStyle}
    >
      {icon ?? <Bot className="size-4" />}
    </span>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: string
}) {
  return (
    <Card className="metric-card rounded-lg py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <div className={`grid size-10 place-items-center rounded-lg ${accent}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-white/55">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-normal text-white">{value}</div>
          <div className="mt-0.5 truncate text-xs text-white/45">{detail}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function UsageRangeControl({ value, onChange }: { value: UsageRange; onChange: (value: UsageRange) => void }) {
  return (
    <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
      {usageRanges.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`h-6 rounded-md px-2 text-[11px] font-medium transition ${
            value === range.value ? 'bg-white/14 text-white shadow-sm' : 'text-white/45 hover:text-white/75'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}

function dateKeyFromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function daysAgoKey(days: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - days)
  return dateKeyFromTime(date.getTime())
}

function recentDateKeys(days: number, offset = 0): Set<string> {
  return new Set(Array.from({ length: days }, (_, index) => daysAgoKey(index + offset)))
}

function sessionCountForDates(sessions: SessionRecord[], dates: Set<string>): number {
  return sessions.filter((session) => dates.has(dateKeyFromTime(new Date(session.lastUpdated).getTime()))).length
}

function cleanupCountForDates(cleanup: CleanupCandidate[], dates: Set<string>): number {
  return cleanup.filter((item) => item.lastUpdated && dates.has(dateKeyFromTime(new Date(item.lastUpdated).getTime()))).length
}

function usageTotalForDates(snapshot: DashboardSnapshot, dates: Set<string>): number {
  return snapshot.usage.reduce((total, point) => total + (dates.has(point.date) ? point.total : 0), 0)
}

function sessionTokenTotalForDates(sessions: SessionRecord[], dates: Set<string>): number {
  return sessions.reduce((total, session) => {
    const usageByDate = session.metadata.usageByDate
    if (usageByDate && typeof usageByDate === 'object' && !Array.isArray(usageByDate)) {
      return total + Object.entries(usageByDate).reduce((sum, [date, value]) => {
        return sum + (dates.has(date) && typeof value === 'number' && Number.isFinite(value) ? value : 0)
      }, 0)
    }

    return dates.has(dateKeyFromTime(new Date(session.lastUpdated).getTime())) ? total + session.tokens.total : total
  }, 0)
}

function trendDetail(current: number, previous: number, unit: string, range: UsageRange): string {
  if (current === 0 && previous === 0) return `No ${unit} in ${range} days`
  if (previous <= 0) return `${current.toLocaleString()} ${unit} in ${range} days`
  const delta = ((current - previous) / previous) * 100
  const direction = delta >= 0 ? '+' : ''
  return `${direction}${delta.toFixed(0)}% vs prior ${range}d`
}

function rangeDateKeys(usage: UsagePoint[], range: UsageRange): Set<string> {
  return new Set(usage.slice(-range).map((point) => point.date))
}

function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.min(8, Math.max(1, Math.ceil((value / max) * 8)))
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${date}T00:00:00`))
}

function buildHeatmapCells(usage: UsagePoint[]): HeatmapCell[] {
  const max = Math.max(...usage.map((point) => point.total), 0)
  const firstDate = usage[0] ? new Date(`${usage[0].date}T00:00:00`) : null
  const firstWeekStart = firstDate ? startOfWeek(firstDate).getTime() : 0
  return usage.map((point) => {
    const date = new Date(`${point.date}T00:00:00`)
    const dayIndex = date.getDay()
    const week = firstDate ? Math.round((startOfWeek(date).getTime() - firstWeekStart) / (7 * 24 * 60 * 60 * 1000)) : 0
    return {
      date: point.date,
      day: dayLabel(point.date),
      value: point.total,
      level: heatLevel(point.total, max),
      week,
      gridColumn: week + 1,
      gridRow: dayIndex === 0 ? 7 : dayIndex,
    }
  })
}

function startOfWeek(date: Date): Date {
  const start = new Date(date)
  const dayIndex = start.getDay()
  start.setDate(start.getDate() - (dayIndex === 0 ? 6 : dayIndex - 1))
  start.setHours(0, 0, 0, 0)
  return start
}

function UsageTooltip({ active, payload, label }: { active?: boolean; payload?: ChartTooltipPayload[]; label?: unknown }) {
  if (!active || !payload?.length) return null
  const total = Number(payload.find((item) => item.dataKey === 'total')?.value ?? 0)
  const point = payload[0]?.payload
  const sources = agentSources
    .map((source) => ({ source, value: point?.[source] ?? 0 }))
    .filter((item) => item.value > 0)

  return (
    <div className="chart-tooltip min-w-44 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-xs font-medium text-white/58">{String(label)}</div>
      <div className="mt-1.5 flex items-center justify-between gap-5">
        <span className="text-[13px] font-medium text-white">total</span>
        <span className="font-mono text-sm font-semibold text-blue-300">{formatTokens(total)}</span>
      </div>
      {sources.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-white/8 pt-2">
          {sources.map((item) => (
            <div key={item.source} className="flex items-center justify-between gap-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-white/50">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: sourceColors[item.source] }} />
                {agentLabel[item.source]}
              </span>
              <span className="font-mono text-white/64">{formatTokens(item.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TokenActivityCard({
  usage,
}: {
  usage: UsagePoint[]
}) {
  const [mode, setMode] = useState<TokenActivityMode>('line')

  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm text-white">Token Activity</CardTitle>
          <div className="flex items-center gap-2">
            <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
              {tokenActivityModes.map((activityMode) => {
                const Icon = activityMode.icon
                return (
                  <Tooltip key={activityMode.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setMode(activityMode.value)}
                        aria-label={`${activityMode.label} view`}
                        aria-pressed={mode === activityMode.value}
                        className={`grid size-6 place-items-center rounded-md transition ${
                          mode === activityMode.value ? 'bg-white/14 text-white shadow-sm' : 'text-white/45 hover:text-white/75'
                        }`}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{activityMode.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="h-[230px]">
        {mode === 'line' && <TokenLineChart usage={usage} />}
        {mode === 'bar' && <TokenBarChart usage={usage} />}
        {mode === 'heat' && <TokenHeatmap usage={usage} />}
      </CardContent>
    </Card>
  )
}

function TokenLineChart({ usage }: { usage: UsagePoint[] }) {
  return (
    <ResponsiveContainer className="chart-static" width="100%" height="100%">
      <LineChart data={usage} accessibilityLayer={false} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,.38)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} tickFormatter={(value) => String(value).slice(5)} />
        <YAxis tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
        <ChartTooltip
          content={<UsageTooltip />}
          cursor={{ stroke: 'rgba(147,197,253,.78)', strokeWidth: 1.5 }}
          wrapperStyle={{ outline: 'none' }}
        />
        <Line
          type="monotone"
          dataKey="total"
          stroke="#63a6ff"
          strokeWidth={2.2}
          dot={false}
          activeDot={{ r: 5, fill: '#63a6ff', stroke: '#f8fbff', strokeWidth: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function TokenBarChart({ usage }: { usage: UsagePoint[] }) {
  return (
    <ResponsiveContainer className="chart-static" width="100%" height="100%">
      <BarChart data={usage} accessibilityLayer={false} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,.38)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} tickFormatter={(value) => String(value).slice(5)} />
        <YAxis tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
        <ChartTooltip
          content={<UsageTooltip />}
          cursor={{ fill: 'rgba(96,165,250,.08)' }}
          wrapperStyle={{ outline: 'none' }}
        />
        {agentSources.map((source) => (
          <Bar
            key={source}
            dataKey={source}
            stackId="tokens"
            fill={sourceColors[source]}
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function TokenHeatmap({ usage }: { usage: UsagePoint[] }) {
  const cells = buildHeatmapCells(usage)
  const weekCount = Math.max(...cells.map((cell) => cell.week), 0) + 1
  const weekLabels = cells.filter((cell, index) => index === 0 || cell.week !== cells[index - 1]?.week)

  return (
    <div className="flex h-full flex-col justify-center">
      <div
        className="token-heatmap-grid"
        style={{ gridTemplateColumns: `36px repeat(${weekCount}, minmax(28px, 1fr))` }}
      >
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
          <div key={day} className="self-center text-[11px] text-white/42" style={{ gridColumn: 1, gridRow: index + 1 }}>
            {day}
          </div>
        ))}
        {cells.map((cell) => (
          <Tooltip key={cell.date}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${cell.date}: ${formatTokens(cell.value)} tokens`}
                className="token-heatmap-cell"
                data-level={cell.level}
                style={{ gridColumn: cell.gridColumn + 1, gridRow: cell.gridRow }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {cell.date} · {formatTokens(cell.value)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div
        className="mt-3 grid pl-9 text-[11px] text-white/38"
        style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(28px, 1fr))` }}
      >
        {weekLabels.map((cell) => (
          <span key={cell.date} className="truncate" style={{ gridColumn: cell.gridColumn }}>
            {cell.date.slice(5)}
          </span>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-white/42">
        <span>Low activity</span>
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className="token-heatmap-legend-cell" data-level={index + 1} />
        ))}
        <span>High activity</span>
      </div>
    </div>
  )
}

function storagePercent(value: number, total: number): string {
  if (total <= 0) return '0.0%'
  return `${((value / total) * 100).toFixed(1)}%`
}

function StorageBreakdownCard({
  storageData,
  storageTotal,
  sessionCount,
}: {
  storageData: StorageDatum[]
  storageTotal: number
  sessionCount: number
}) {
  const [mode, setMode] = useState<StorageViewMode>('pie')
  const title = mode === 'layout' ? 'Storage Layout' : 'Storage Breakdown'
  const subtitle = mode === 'list' ? 'By source' : undefined

  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm text-white">{title}</CardTitle>
            {subtitle && <div className="mt-0.5 text-xs font-medium text-white/42">{subtitle}</div>}
          </div>
          <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
            {storageViewModes.map((viewMode) => {
              const Icon = viewMode.icon
              return (
                <Tooltip key={viewMode.value}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setMode(viewMode.value)}
                      aria-label={`${viewMode.label} view`}
                      aria-pressed={mode === viewMode.value}
                      className={`grid size-6 place-items-center rounded-md transition ${
                        mode === viewMode.value ? 'bg-white/14 text-white shadow-sm' : 'text-white/45 hover:text-white/75'
                      }`}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{viewMode.label}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="h-[230px]">
        {mode === 'layout' && <StorageLayoutView storageData={storageData} storageTotal={storageTotal} />}
        {mode === 'list' && <StorageListView storageData={storageData} storageTotal={storageTotal} sessionCount={sessionCount} />}
        {mode === 'pie' && <StoragePieView storageData={storageData} storageTotal={storageTotal} sessionCount={sessionCount} />}
      </CardContent>
    </Card>
  )
}

function StorageLayoutView({ storageData, storageTotal }: { storageData: StorageDatum[]; storageTotal: number }) {
  if (storageData.length === 0) {
    return <div className="grid h-full place-items-center text-xs text-white/45">No storage activity in this range</div>
  }

  const [primary, secondary, ...rest] = storageData

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="storage-layout-grid min-h-0 flex-1">
        {primary && <StorageLayoutTile slice={primary} total={storageTotal} className="storage-layout-primary" />}
        {secondary && <StorageLayoutTile slice={secondary} total={storageTotal} className="storage-layout-secondary" />}
        {rest.length > 0 && (
          <div className="storage-layout-rest">
            {rest.map((slice) => (
              <StorageLayoutTile key={slice.source} slice={slice} total={storageTotal} />
            ))}
          </div>
        )}
      </div>
      <StorageLegend storageData={storageData} storageTotal={storageTotal} />
    </div>
  )
}

function StorageLayoutTile({ slice, total, className = '' }: { slice: StorageDatum; total: number; className?: string }) {
  const percent = total > 0 ? (slice.value / total) * 100 : 0
  const density = percent < 1 ? 'tiny' : percent < 6 ? 'compact' : 'full'

  return (
    <div
      className={`storage-layout-tile ${className}`}
      data-source={slice.source}
      data-density={density}
      style={{ '--tile-color': sourceColors[slice.source] } as CSSProperties}
    >
      <div className="relative z-10 min-w-0">
        <div className="storage-layout-label truncate text-[13px] font-semibold text-white/88">{slice.name}</div>
        {density !== 'tiny' && <div className="mt-1 text-xs font-medium text-white/62">{formatBytes(slice.value)}</div>}
        {density === 'full' && <div className="mt-0.5 text-xs font-semibold text-white/52">{storagePercent(slice.value, total)}</div>}
      </div>
    </div>
  )
}

function StorageLegend({ storageData, storageTotal }: { storageData: StorageDatum[]; storageTotal: number }) {
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden">
      {storageData.slice(0, 5).map((slice) => (
        <div key={slice.source} className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-white/45">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: sourceColors[slice.source] }} />
          <span className="truncate">{slice.name} ({storagePercent(slice.value, storageTotal)})</span>
        </div>
      ))}
    </div>
  )
}

function StorageListView({
  storageData,
  storageTotal,
  sessionCount,
}: {
  storageData: StorageDatum[]
  storageTotal: number
  sessionCount: number
}) {
  return (
    <div className="storage-list-view flex h-full flex-col justify-center gap-3">
      {storageData.length === 0 && <div className="text-xs text-white/45">No storage activity in this range</div>}
      {storageData.slice(0, 5).map((slice) => (
        <div key={slice.source} className="grid grid-cols-[112px_1fr_72px] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: sourceColors[slice.source] }} />
            <span className="truncate text-[13px] font-medium text-white/70">{slice.name}</span>
          </div>
          <div
            className="storage-meter"
            style={{ '--meter-color': sourceColors[slice.source], '--meter-value': `${(slice.value / Math.max(storageTotal, 1)) * 100}%` } as CSSProperties}
          >
            <span className="storage-meter-fill" />
          </div>
          <span className="shrink-0 text-right text-[13px] font-semibold text-white/58">{formatBytes(slice.value)}</span>
        </div>
      ))}
      {storageTotal > 0 && (
        <div className="mt-1 grid grid-cols-[112px_1fr_72px] items-center gap-3 border-t border-white/7 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <Database className="size-4 text-blue-300" />
            <span className="text-[13px] font-semibold text-white/70">Total</span>
          </div>
          <span className="text-[11px] text-white/35">{sessionCount.toLocaleString()} sessions</span>
          <span className="text-right text-[13px] font-semibold text-white/64">{formatBytes(storageTotal)}</span>
        </div>
      )}
    </div>
  )
}

function StoragePieView({
  storageData,
  storageTotal,
  sessionCount,
}: {
  storageData: StorageDatum[]
  storageTotal: number
  sessionCount: number
}) {
  return (
    <div className="grid h-full grid-cols-[150px_1fr] items-center gap-3">
      <ResponsiveContainer className="chart-static" width="100%" height={170}>
        <PieChart accessibilityLayer={false}>
          <Pie data={storageData} innerRadius={44} outerRadius={72} paddingAngle={2} dataKey="value" isAnimationActive={false}>
            {storageData.map((entry) => (
              <Cell key={entry.name} fill={sourceColors[entry.source]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-3">
        {storageData.length === 0 && <div className="text-xs text-white/45">No storage activity in this range</div>}
        {storageData.slice(0, 5).map((slice) => (
          <div key={`${slice.source}-${slice.name}`} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: sourceColors[slice.source] }} />
              <span className="truncate text-white/70">{slice.name}</span>
            </div>
            <span className="text-white/48">{formatBytes(slice.value)}</span>
          </div>
        ))}
        {storageTotal > 0 && <div className="border-t border-white/7 pt-2 text-[11px] text-white/38">{formatBytes(storageTotal)} across {sessionCount.toLocaleString()} sessions</div>}
      </div>
    </div>
  )
}

function Sidebar({
  activeView,
  setActiveView,
  snapshot,
}: {
  activeView: ViewId
  setActiveView: (view: ViewId) => void
  snapshot: DashboardSnapshot
}) {
  return (
    <aside className="sidebar-glass drag-region flex w-[232px] shrink-0 flex-col px-4 pb-4 pt-5">
      <div className="mb-7 flex items-center gap-2 pl-2 pt-8">
        <img src="/app-logo.png" alt="" className="size-10 shrink-0 object-contain" draggable={false} />
        <div>
          <div className="text-sm font-medium text-white">Clean My Agent</div>
          <div className="text-[11px] text-white/40">Local session control</div>
        </div>
      </div>

      <nav className="space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = activeView === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition ${
                active ? 'bg-white/11 text-white shadow-inner' : 'text-white/66 hover:bg-white/7 hover:text-white'
              }`}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-8 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-white/35">
        <span>Sources</span>
        <Circle className="size-3 fill-emerald-300/70 text-emerald-300/70" />
      </div>
      <div className="mt-3 space-y-2">
        {snapshot.agents.map((agent) => (
          <div key={agent.source} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-white/70">
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white/82">{agent.name}</div>
              <div className="text-[11px] text-white/38">
                {agent.sessionCount} sessions · {agent.readable ? 'Readable' : 'Not found'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto rounded-lg border border-white/8 bg-black/18 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-white/80">
          <ShieldCheck className="size-4 text-emerald-300" />
          Safe by default
        </div>
        <p className="mt-2 text-[11px] leading-4 text-white/42">Cleanup moves files to app Trash. Session candidates are backed up first.</p>
      </div>

    </aside>
  )
}

function Topbar({
  activeView,
  loading,
  mockDataEnabled,
  overviewRange,
  resolvedTheme,
  onThemeToggle,
  onOverviewRangeChange,
  onRescan,
}: {
  activeView: ViewId
  loading: boolean
  mockDataEnabled: boolean
  overviewRange: UsageRange
  resolvedTheme: 'light' | 'dark'
  onThemeToggle: () => void
  onOverviewRangeChange: (range: UsageRange) => void
  onRescan: () => Promise<void>
}) {
  const title = navItems.find((item) => item.id === activeView)?.label ?? 'Overview'
  const ThemeIcon = resolvedTheme === 'dark' ? Sun : Moon
  const nextThemeLabel = resolvedTheme === 'dark' ? 'light' : 'dark'
  const subtitle =
    activeView === 'cleanup'
      ? 'Review and remove safe, backed up, or redundant session data.'
      : mockDataEnabled
        ? 'Previewing balanced demo data'
        : 'Local-first scan of your AI coding sessions'

  return (
    <header className="drag-region flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-7">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-0.5 text-xs text-white/42">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {mockDataEnabled && (
          <Badge variant="outline" className="border-violet-300/20 bg-violet-400/10 text-violet-200">
            Demo
          </Badge>
        )}
        {activeView === 'overview' && <UsageRangeControl value={overviewRange} onChange={onOverviewRangeChange} />}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onThemeToggle}
              aria-label={`Switch to ${nextThemeLabel} mode`}
              className="theme-toggle border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <ThemeIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Switch to {nextThemeLabel} mode</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-sm" onClick={() => void onRescan()} disabled={loading} className="border-white/10 bg-white/5 text-white hover:bg-white/10">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rescan local agent data</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function OverviewView({
  snapshot,
  usageRange,
  onSelectCleanup,
}: {
  snapshot: DashboardSnapshot
  usageRange: UsageRange
  onSelectCleanup: () => void
}) {
  const recentSessions = snapshot.sessions.slice(0, 6)
  const currentRangeDates = recentDateKeys(usageRange)
  const priorRangeDates = recentDateKeys(usageRange, usageRange)
  const sessionsInRange = sessionCountForDates(snapshot.sessions, currentRangeDates)
  const sessionsPriorRange = sessionCountForDates(snapshot.sessions, priorRangeDates)
  const backupsInRange = snapshot.backups.filter((backup) => currentRangeDates.has(dateKeyFromTime(new Date(backup.createdAt).getTime()))).length
  const backupsPriorRange = snapshot.backups.filter((backup) => priorRangeDates.has(dateKeyFromTime(new Date(backup.createdAt).getTime()))).length
  const cleanupInRange = cleanupCountForDates(snapshot.cleanup, currentRangeDates)
  const cleanupPriorRange = cleanupCountForDates(snapshot.cleanup, priorRangeDates)
  const tokensInRange = sessionTokenTotalForDates(snapshot.sessions, currentRangeDates) || usageTotalForDates(snapshot, currentRangeDates)
  const tokensPriorRange = sessionTokenTotalForDates(snapshot.sessions, priorRangeDates) || usageTotalForDates(snapshot, priorRangeDates)
  const rangeUsage = snapshot.usage.slice(-usageRange)
  const selectedDateKeys = rangeDateKeys(snapshot.usage, usageRange)
  const rangeSessions = snapshot.sessions.filter((session) => selectedDateKeys.has(dateKeyFromTime(new Date(session.lastUpdated).getTime())))
  const storageData = agentSources
    .map((source) => {
      const sessions = rangeSessions.filter((session) => session.source === source)
      return {
        name: agentLabel[source],
        value: sessions.reduce((total, session) => total + session.sizeBytes, 0),
        source,
        sessions: sessions.length,
      }
    })
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value)
  const storageTotal = storageData.reduce((total, slice) => total + slice.value, 0)

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-4 gap-3">
        <MetricCard icon={Database} label="Total Sessions" value={snapshot.overview.totalSessions.toLocaleString()} detail={trendDetail(sessionsInRange, sessionsPriorRange, 'sessions', usageRange)} accent="bg-emerald-400/12 text-emerald-300" />
        <MetricCard icon={Archive} label="Backed Up" value={snapshot.overview.backedUpSessions.toLocaleString()} detail={trendDetail(backupsInRange, backupsPriorRange, 'backups', usageRange)} accent="bg-blue-400/12 text-blue-300" />
        <MetricCard icon={HardDrive} label="Reclaimable" value={formatBytes(snapshot.overview.reclaimableBytes)} detail={trendDetail(cleanupInRange, cleanupPriorRange, 'suggestions', usageRange)} accent="bg-amber-400/12 text-amber-300" />
        <MetricCard
          icon={Gauge}
          label="Token Usage"
          value={formatTokens(snapshot.overview.totalTokens)}
          detail={trendDetail(tokensInRange, tokensPriorRange, 'tokens', usageRange)}
          accent="bg-violet-400/12 text-violet-300"
        />
      </section>

      <section className="grid grid-cols-[1fr_400px] gap-4">
        <TokenActivityCard usage={rangeUsage} />
        <StorageBreakdownCard storageData={storageData} storageTotal={storageTotal} sessionCount={rangeSessions.length} />
      </section>

      <section className="grid grid-cols-[1fr_400px] gap-4">
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0">
            <div className="flex w-full items-center justify-between">
              <CardTitle className="text-sm text-white">Recent Sessions</CardTitle>
              <Button variant="ghost" size="sm" className="text-blue-300 hover:bg-blue-400/10 hover:text-blue-200">View all</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-white/7">
              {recentSessions.map((session) => (
                <div key={session.id} className="grid grid-cols-[28px_1fr_120px_80px_80px] items-center gap-3 py-2.5 text-xs">
                  <AgentGlyph source={session.source} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white/82">{session.title}</div>
                    <div className="truncate text-white/38">{session.projectName}</div>
                  </div>
                  <span className="truncate text-white/42">{session.branch ?? 'Unknown'}</span>
                  <span className="text-white/42">{formatRelative(session.lastUpdated)}</span>
                  <span className="text-right text-white/50">{formatBytes(session.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0">
            <div className="flex w-full items-center justify-between">
              <CardTitle className="text-sm text-white">Smart Cleanup</CardTitle>
              <Button variant="ghost" size="sm" onClick={onSelectCleanup} className="text-blue-300 hover:bg-blue-400/10 hover:text-blue-200">Review</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.cleanup.slice(0, 4).map((candidate) => (
                <CleanupMiniRow key={candidate.id} candidate={candidate} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function CleanupMiniRow({ candidate }: { candidate: CleanupCandidate }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-white/7 bg-white/[0.03] p-3">
      <div className={`grid size-8 place-items-center rounded-md ring-1 ${riskAccent[candidate.risk]}`}>
        <Trash2 className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-white/82">{candidate.title}</div>
        <div className="truncate text-[11px] text-white/38">{candidate.reason}</div>
      </div>
      <div className="text-right text-xs font-semibold text-amber-300">{formatBytes(candidate.sizeBytes)}</div>
    </div>
  )
}

function SessionsView({
  sessions,
  onBackup,
  onExport,
  onRelay,
}: {
  sessions: SessionRecord[]
  onBackup: (sessionId: string) => Promise<void>
  onExport: (sessionId: string) => Promise<void>
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState<'all' | AgentSource>('all')
  const filtered = sessions.filter((session) => {
    const haystack = `${session.title} ${session.projectName} ${session.branch ?? ''} ${agentLabel[session.source]}`.toLowerCase()
    return haystack.includes(query.toLowerCase()) && (agent === 'all' || session.source === agent)
  })

  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm text-white">Unified Sessions</CardTitle>
            <p className="mt-1 text-xs text-white/42">Codex, Claude Code, Cursor, Gemini, and OpenCode sessions in one index.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/35" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions..." className="h-8 w-64 border-white/10 bg-white/5 pl-8 text-white placeholder:text-white/30" />
            </div>
            <select value={agent} onChange={(event) => setAgent(event.target.value as 'all' | AgentSource)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none">
              <option value="all">All Agents</option>
              {Object.entries(agentLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-white/8">
          <Table>
            <TableHeader className="bg-white/[0.03]">
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="text-white/45">Agent</TableHead>
                <TableHead className="text-white/45">Session</TableHead>
                <TableHead className="text-white/45">Project</TableHead>
                <TableHead className="text-white/45">Branch</TableHead>
                <TableHead className="text-white/45">Updated</TableHead>
                <TableHead className="text-right text-white/45">Tokens</TableHead>
                <TableHead className="text-right text-white/45">Size</TableHead>
                <TableHead className="text-white/45">Backup</TableHead>
                <TableHead className="text-right text-white/45">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 80).map((session) => (
                <TableRow key={session.id} className="border-white/7 hover:bg-white/[0.035]">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AgentGlyph source={session.source} />
                      <span className="text-xs text-white/70">{agentLabel[session.source]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate font-medium text-white/82">{session.title}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-white/55">{session.projectName}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-white/45">{session.branch ?? 'Unknown'}</TableCell>
                  <TableCell className="text-white/45">{formatRelative(session.lastUpdated)}</TableCell>
                  <TableCell className="text-right text-white/60">{formatTokens(session.tokens.total)}</TableCell>
                  <TableCell className="text-right text-white/60">{formatBytes(session.sizeBytes)}</TableCell>
                  <TableCell>
                    {session.backupStatus === 'backed-up' ? (
                      <Badge className="bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-3" />Backed Up</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400/20 bg-amber-400/10 text-amber-300">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => void onBackup(session.id)} className="text-white/55 hover:bg-white/10 hover:text-white"><Archive className="size-3.5" /></Button></TooltipTrigger>
                        <TooltipContent>Backup session</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => void onExport(session.id)} className="text-white/55 hover:bg-white/10 hover:text-white"><Download className="size-3.5" /></Button></TooltipTrigger>
                        <TooltipContent>Export Markdown</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => void onRelay(session.id)} className="text-white/55 hover:bg-white/10 hover:text-white"><FileJson2 className="size-3.5" /></Button></TooltipTrigger>
                        <TooltipContent>Export universal relay JSON</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function CleanupView({
  cleanup,
  onMoveToTrash,
}: {
  cleanup: CleanupCandidate[]
  onMoveToTrash: (candidateIds: string[]) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>(cleanup.slice(0, 3).map((item) => item.id))
  const selectedBytes = cleanup.filter((item) => selected.includes(item.id)).reduce((total, item) => total + item.sizeBytes, 0)
  const selectedItems = cleanup.filter((item) => selected.includes(item.id))
  const accentByKind: Record<CleanupCandidate['kind'], string> = {
    'old-session': 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/28',
    'backed-up-session': 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/28',
    'large-log': 'text-amber-300 bg-amber-400/13 ring-amber-400/28',
    'duplicate-backup': 'text-blue-300 bg-blue-400/13 ring-blue-400/28',
    'temp-file': 'text-sky-300 bg-sky-400/13 ring-sky-400/28',
    'orphan-session': 'text-violet-300 bg-violet-400/13 ring-violet-400/28',
    'invalid-cache': 'text-red-300 bg-red-400/13 ring-red-400/28',
  }
  const selectedColor = (index: number) => ['bg-emerald-300', 'bg-amber-300', 'bg-blue-300', 'bg-violet-300', 'bg-sky-300'][index % 5]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_334px] gap-6 max-[1120px]:grid-cols-1">
      <Card className="glass-panel overflow-hidden rounded-lg py-0">
        <CardHeader className="flex-row items-center justify-between gap-3 px-8 pb-0 pt-8">
          <div>
            <CardTitle className="text-[20px] font-semibold text-white">Cleanup Suggestions</CardTitle>
            <p className="mt-3 text-[15px] text-white/60">Review each suggestion. Items are backed up first and can be recovered.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-[15px] font-normal text-white/82 hover:bg-white/10">
              <ListFilter className="size-4" />
              Filter
            </Button>
            <select className="h-9 rounded-lg border border-white/12 bg-white/5 px-3 text-[15px] text-white/82 outline-none">
              <option>Sort: Size</option>
              <option>Sort: Risk</option>
              <option>Sort: Agent</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-0 pt-7">
          <div className="space-y-3">
            {cleanup.map((candidate) => {
              const checked = selected.includes(candidate.id)
              return (
                <div
                  key={candidate.id}
                  className={`cleanup-row group grid min-h-[145px] grid-cols-[28px_58px_minmax(0,1fr)_104px] items-center gap-4 rounded-lg border px-4 py-5 text-left transition max-[1280px]:grid-cols-[24px_58px_minmax(0,1fr)] max-[1280px]:items-start ${
                    checked ? 'border-white/12 bg-white/[0.055]' : 'border-white/9 bg-white/[0.03] hover:bg-white/[0.05]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelected((current) => checked ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                    aria-label={`${checked ? 'Deselect' : 'Select'} ${candidate.title}`}
                    className={`grid size-6 place-items-center rounded-md border transition ${
                      checked ? 'border-white/22 bg-white/10 text-white' : 'border-white/16 bg-black/12 text-transparent group-hover:text-white/45'
                    }`}
                  >
                    <CheckCircle2 className="size-4" />
                  </button>
                  <div className={`grid size-[58px] place-items-center rounded-lg ring-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_10%)] ${accentByKind[candidate.kind]}`}>
                    {candidate.kind === 'duplicate-backup' ? (
                      <Archive className="size-7" />
                    ) : checked ? (
                      <CheckCircle2 className="size-7" />
                    ) : (
                      <Trash2 className="size-7" />
                    )}
                  </div>
                  <div className="min-w-0 max-[1280px]:pr-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                      <div className="min-w-0 truncate text-[18px] font-semibold text-white">{candidate.title}</div>
                      <Badge variant="outline" className={`h-6 rounded-full px-3 text-xs capitalize ring-1 ${riskAccent[candidate.risk]}`}>{candidate.risk} risk</Badge>
                      {candidate.backedUp && <Badge className="h-6 rounded-full bg-emerald-400/10 px-3 text-xs text-emerald-300 ring-1 ring-emerald-400/20">Backed up</Badge>}
                    </div>
                    <p className="mt-2 text-[15px] leading-6 text-white/58">{candidate.reason}</p>
                    <div className="mt-4 flex flex-wrap gap-3 text-[13px] text-white/42">
                      <span>{candidate.paths.length} path{candidate.paths.length === 1 ? '' : 's'}</span>
                      <span>·</span>
                      <span>{candidate.recoverable ? 'Recoverable from Trash' : 'Permanent'}</span>
                      {candidate.source && <><span>·</span><span>{agentLabel[candidate.source]}</span></>}
                    </div>
                  </div>
                  <div className="text-right max-[1280px]:col-start-3 max-[1280px]:text-left">
                    <div className={`text-[22px] font-semibold ${candidate.kind === 'duplicate-backup' ? 'text-blue-300' : candidate.risk === 'medium' ? 'text-amber-300' : 'text-emerald-300'}`}>{formatBytes(candidate.sizeBytes)}</div>
                    <div className="mt-2 text-[13px] text-white/48">{candidate.kind.replaceAll('-', ' ')}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/8 px-1 py-7">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 size-5 text-emerald-300" />
              <div>
                <div className="text-[16px] font-medium text-white">{selected.length} suggestions selected</div>
                <div className="mt-1 text-sm text-white/52">{formatBytes(selectedBytes)} reclaimable</div>
              </div>
            </div>
            <Button variant="outline" size="lg" onClick={() => setSelected([])} disabled={selected.length === 0} className="h-9 rounded-lg border-white/12 bg-white/5 px-4 text-[15px] font-normal text-white/72 hover:bg-white/10 hover:text-white">
              Deselect all
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-panel sticky top-6 h-fit rounded-lg py-0">
        <CardHeader className="flex-row items-center justify-between px-7 pb-0 pt-8">
          <CardTitle className="text-[20px] font-semibold text-white">Clean Queue</CardTitle>
          <Pin className="size-5 text-white/82" />
        </CardHeader>
        <CardContent className="px-7 pb-6 pt-7">
          <div>
            <div className="flex items-end gap-2 text-white">
              <span className="text-[46px] font-semibold leading-none">{formatBytes(selectedBytes).split(' ')[0]}</span>
              <span className="pb-1 text-[25px] font-semibold">{formatBytes(selectedBytes).split(' ')[1] ?? ''}</span>
            </div>
            <div className="mt-3 text-[15px] text-white/58">{selected.length} items selected</div>
          </div>
          <Separator className="my-7 bg-white/10" />
          <div className="space-y-5 text-[15px] text-white/62">
            <div className="flex items-center gap-3"><ShieldCheck className="size-5 text-emerald-300" />Backed up before removal</div>
            <div className="flex items-center gap-3"><Trash2 className="size-5 text-blue-300" />Moved to app Trash</div>
            <div className="flex items-center gap-3"><Clock className="size-5 text-amber-300" />Trash retention is configurable</div>
            <div className="flex items-center gap-3"><RefreshCcw className="size-5 text-violet-300" />Easily recoverable</div>
          </div>
          <Separator className="my-7 bg-white/10" />
          <div>
            <div className="text-[15px] font-medium text-white">Selected items</div>
            <div className="mt-4 space-y-3">
              {selectedItems.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2 text-[14px]">
                  <span className={`size-2.5 rounded-full ${selectedColor(index)}`} />
                  <span className="min-w-0 flex-1 truncate text-white/58">{item.kind.replaceAll('-', ' ')}</span>
                  <span className="text-white/58">{formatBytes(item.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </div>
          <Separator className="my-7 bg-white/10" />
          <div className="flex items-center justify-between text-[16px]">
            <span className="text-white">Total reclaimable</span>
            <span className="font-semibold text-white">{formatBytes(selectedBytes)}</span>
          </div>
          <Button onClick={() => void onMoveToTrash(selected)} disabled={selected.length === 0} className="mt-6 h-11 w-full rounded-lg bg-blue-500 text-[16px] font-semibold text-white shadow-[0_10px_24px_rgb(37_99_235_/_28%)] hover:bg-blue-400">
            <Trash2 className="size-5" />
            Move to Trash
          </Button>
          <p className="mt-3 text-center text-[13px] text-white/45">Files will be moved to app Trash</p>
        </CardContent>
      </Card>
    </div>
  )
}

function UsageView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const projectRows = Object.values(
    snapshot.sessions.reduce<Record<string, { project: string; tokens: number; sessions: number }>>((acc, session) => {
      acc[session.projectName] ??= { project: session.projectName, tokens: 0, sessions: 0 }
      acc[session.projectName].tokens += session.tokens.total
      acc[session.projectName].sessions += 1
      return acc
    }, {}),
  ).sort((a, b) => b.tokens - a.tokens)

  const agentRows = snapshot.agents.map((agent) => ({
    agent: agent.name,
    source: agent.source,
    tokens: snapshot.sessions.filter((session) => session.source === agent.source).reduce((total, session) => total + session.tokens.total, 0),
  }))

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Agent Token Comparison</CardTitle>
        </CardHeader>
        <CardContent className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={snapshot.usage.slice(-14)}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,.38)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
              <ChartTooltip contentStyle={{ background: '#18191b', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }} formatter={(value) => formatTokens(Number(value))} />
              <Bar dataKey="codex" stackId="a" fill={sourceColors.codex} radius={[0, 0, 0, 0]} />
              <Bar dataKey="claude" stackId="a" fill={sourceColors.claude} />
              <Bar dataKey="cursor" stackId="a" fill={sourceColors.cursor} />
              <Bar dataKey="gemini" stackId="a" fill={sourceColors.gemini} />
              <Bar dataKey="opencode" stackId="a" fill={sourceColors.opencode} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0"><CardTitle className="text-sm text-white">By Agent</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {agentRows.map((row) => (
              <div key={row.source}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-white/70">{row.agent}</span>
                  <span className="text-white/45">{formatTokens(row.tokens)}</span>
                </div>
                <Progress value={(row.tokens / Math.max(snapshot.overview.totalTokens, 1)) * 100} className="h-1.5 bg-white/8" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0"><CardTitle className="text-sm text-white">Top Projects</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {projectRows.slice(0, 7).map((row, index) => (
              <div key={row.project} className="flex items-center gap-3 text-xs">
                <span className="grid size-5 place-items-center rounded bg-white/7 text-white/42">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-white/70">{row.project}</span>
                <span className="text-white/45">{formatTokens(row.tokens)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function RelayView({
  sessions,
  onRelay,
}: {
  sessions: SessionRecord[]
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [selected, setSelected] = useState(sessions[0]?.id ?? '')
  const session = sessions.find((item) => item.id === selected)

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Universal Relay JSON</CardTitle>
          <p className="mt-1 text-xs text-white/42">V0 extracts chats into a common schema. Agent-specific converters can target Codex, Claude Code, Cursor, Gemini, or OpenCode later.</p>
        </CardHeader>
        <CardContent>
          <pre className="overflow-hidden rounded-lg border border-white/8 bg-black/25 p-4 text-xs leading-5 text-white/58">
{`{
  "schema": "clean-my-agent.universal-session.v1",
  "source": "${session?.source ?? 'codex'}",
  "session": {
    "title": "${session?.title ?? 'Select a session'}",
    "projectPath": "${session?.projectPath ?? ''}",
    "branch": "${session?.branch ?? ''}"
  },
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "files": [],
  "commands": [],
  "git": { "diff": null },
  "attachments": []
}`}
          </pre>
        </CardContent>
      </Card>

      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0"><CardTitle className="text-sm text-white">Export Source</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none">
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>{agentLabel[item.source]} · {item.title}</option>
            ))}
          </select>
          {session && (
            <div className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2"><AgentGlyph source={session.source} /><span className="text-sm font-medium text-white/82">{session.title}</span></div>
              <div className="mt-3 space-y-1 text-xs text-white/42">
                <div>{session.projectName}</div>
                <div>{session.messageCount} messages · {formatTokens(session.tokens.total)} tokens</div>
              </div>
            </div>
          )}
          <Button disabled={!session} onClick={() => session && void onRelay(session.id)} className="w-full bg-blue-500 text-white hover:bg-blue-400">
            <FileJson2 className="size-4" />
            Export Universal JSON
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function HealthView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {snapshot.agents.map((agent) => (
        <Card key={agent.source} className="glass-panel rounded-lg py-4">
          <CardContent className="flex items-start gap-3">
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="font-medium text-white">{agent.name}</div>
                <Badge className={agent.readable ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}>{agent.readable ? 'Readable' : 'Not found'}</Badge>
              </div>
              <div className="mt-2 text-xs text-white/42">{agent.sessionCount} sessions · {formatBytes(agent.sizeBytes)}</div>
              <div className="mt-3 space-y-1">
                {agent.rootPaths.map((root) => (
                  <div key={root} className="truncate rounded border border-white/7 bg-white/[0.03] px-2 py-1 text-[11px] text-white/38">{root}</div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function SettingsView({
  mockDataEnabled,
  onMockDataChange,
}: {
  mockDataEnabled: boolean
  onMockDataChange: (enabled: boolean) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-[1080px]:grid-cols-1">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Display Data</CardTitle>
          <p className="mt-1 text-xs text-white/42">Switch between live local scan results and a balanced demo dataset for visual review.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-white/[0.035] p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white/82">Demo data</div>
              <div className="mt-1 text-xs leading-5 text-white/42">Overview, Usage, Cleanup, Sessions, Relay, and Health use curated mock values while enabled.</div>
            </div>
            <Switch
              checked={mockDataEnabled}
              onCheckedChange={(checked) => void onMockDataChange(checked)}
              className="data-checked:bg-violet-400"
              aria-label="Toggle demo data"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Settings Scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            ['Scan directories', 'Configure per-agent roots for all supported agents.'],
            ['Trash retention', 'Keep deleted files recoverable before permanent cleanup.'],
            ['Backup defaults', 'Create raw-copy backups before risky cleanup actions.'],
            ['Relay mode', 'Universal JSON first, target-agent converters later.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm font-medium text-white/82">{title}</div>
              <div className="mt-2 text-xs leading-5 text-white/42">{body}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>('overview')
  const [overviewRange, setOverviewRange] = useState<UsageRange>(30)
  const dashboard = useDashboard()
  const theme = useTheme()

  const content = useMemo(() => {
    switch (activeView) {
      case 'overview':
        return <OverviewView snapshot={dashboard.snapshot} usageRange={overviewRange} onSelectCleanup={() => setActiveView('cleanup')} />
      case 'sessions':
        return <SessionsView sessions={dashboard.snapshot.sessions} onBackup={dashboard.backupSession} onExport={(id) => dashboard.exportSession(id, 'markdown')} onRelay={dashboard.exportUniversalRelay} />
      case 'cleanup':
        return <CleanupView cleanup={dashboard.snapshot.cleanup} onMoveToTrash={dashboard.moveCleanupToTrash} />
      case 'usage':
        return <UsageView snapshot={dashboard.snapshot} />
      case 'relay':
        return <RelayView sessions={dashboard.snapshot.sessions} onRelay={dashboard.exportUniversalRelay} />
      case 'health':
        return <HealthView snapshot={dashboard.snapshot} />
      case 'settings':
        return <SettingsView mockDataEnabled={dashboard.mockDataEnabled} onMockDataChange={dashboard.setMockDataEnabled} />
      default:
        return null
    }
  }, [activeView, dashboard, overviewRange])

  return (
    <TooltipProvider>
      <div className={`mac-window theme-${theme.resolvedTheme} flex h-screen overflow-hidden text-white`}>
        <Sidebar activeView={activeView} setActiveView={setActiveView} snapshot={dashboard.snapshot} />
        <main className="main-surface soft-grid flex min-w-0 flex-1 flex-col">
          <Topbar
            activeView={activeView}
            loading={dashboard.loading}
            mockDataEnabled={dashboard.mockDataEnabled}
            overviewRange={overviewRange}
            resolvedTheme={theme.resolvedTheme}
            onThemeToggle={() => theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark')}
            onOverviewRangeChange={setOverviewRange}
            onRescan={dashboard.rescan}
          />
          <div className="content-scroll no-drag-region min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-5">{content}</div>
          </div>
        </main>
      </div>
      <Toaster theme={theme.resolvedTheme} position="top-right" />
    </TooltipProvider>
  )
}

export default App
