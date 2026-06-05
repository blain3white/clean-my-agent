import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import CodexIcon from '@lobehub/icons/es/Codex'
import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode'
import CursorIcon from '@lobehub/icons/es/Cursor'
import GeminiIcon from '@lobehub/icons/es/Gemini'
import OpenCodeIcon from '@lobehub/icons/es/OpenCode'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity,
  Archive,
  ArrowRightLeft,
  BarChart3,
  Bot,
  CalendarDays,
  ChartNoAxesColumn,
  ChartSpline,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Database,
  Download,
  Eye,
  FileJson2,
  FlaskConical,
  Gauge,
  Grid3X3,
  HardDrive,
  HeartPulse,
  LayoutDashboard,
  ListFilter,
  Loader2,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pin,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import {
  Area,
  AreaChart,
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  agentLabel,
  formatBytes,
  formatCost,
  formatRelative,
  formatTokens,
  riskAccent,
} from '@/lib/format'
import {
  agentSources,
  type ArchiveRecord,
  type AgentSource,
  type CleanupCandidate,
  type DashboardSnapshot,
  type SessionRecord,
  type UsagePoint,
} from '@/shared/types'
import './App.css'

type ViewId = 'overview' | 'sessions' | 'cleanup' | 'usage' | 'relay' | 'health' | 'settings'
type AgentLogoStyle = CSSProperties & { '--agent-color': string }
type UsageRange = 7 | 14 | 30 | 'all'
type UsagePageRange = '7d' | '30d' | '90d' | 'all'
type UsageHeatmapMetric = 'tokens' | 'sessions' | 'cost'
type UsageTrendMetric = 'tokens' | 'cost'
type UsageTokenType = 'input' | 'output' | 'cache' | 'tools'
type TokenActivityMode = 'line' | 'bar' | 'heat'
type StorageViewMode = 'pie' | 'line' | 'layout'
type ChartTooltipPayload = {
  dataKey?: string
  value?: unknown
  payload?: UsagePoint
}
type StorageDatum = {
  name: string
  value: number
  source: AgentSource | 'archives'
  sessions: number
}
type StorageChartTooltipPayload = {
  payload?: StorageDatum
}
type StorageVisualStyle = CSSProperties & {
  '--storage-color': string
  '--storage-bright': string
  '--storage-deep': string
  '--storage-glow': string
}
type HeatmapCell = {
  date: string
  day: string
  value: number
  level: number
  gridColumn: number
  gridRow: number
}
type UsageSummary = {
  totalTokens: number
  estimatedCost: number
  costCoverage: number
  activeSessions: number
  avgTokensPerDay: number
  peakHour: {
    startHour: number
    endHour: number
    tokens: number
  }
}
type UsageHeatmapCell = {
  date: string
  hour: number
  tokens: number
  sessions: number
  cost: number
}
type TokenMix = {
  input: number
  output: number
  cache: number
  tools: number
}
type AgentUsage = {
  agent: string
  source: AgentSource
  tokens: number
  cost: number
  share: number
  hasTokenMetadata: boolean
}
type ProjectUsage = {
  project: string
  projectPath?: string
  tokens: number
  cost: number
  share: number
  trend: number[]
  costTrend: number[]
  trendDates: string[]
}
type PeakWindow = {
  rank: number
  startHour: number
  endHour: number
  tokens: number
  share: number
  histogram: number[]
}
type DailyUsageTrendPoint = {
  date: string
  input: number
  output: number
  cache: number
  tools: number
  total: number
  cost: number
}
type DailyUsageTooltipPayload = {
  dataKey?: string
  value?: unknown
  payload?: DailyUsageTrendPoint
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

const storageSourceColors: Record<AgentSource | 'archives', string> = {
  ...sourceColors,
  archives: '#34d399',
}

const storageSources: Array<AgentSource | 'archives'> = [...agentSources, 'archives']

const tokenBarGlowColors: Record<
  AgentSource | 'archives',
  { bright: string; base: string; deep: string; glow: string }
> = {
  codex: { bright: '#c4b5fd', base: '#9f7aea', deep: '#6d4bd8', glow: '#a78bfa' },
  claude: { bright: '#fdba74', base: '#fb923c', deep: '#c45a1d', glow: '#fb923c' },
  cursor: { bright: '#f8fafc', base: '#cbd5e1', deep: '#718096', glow: '#cbd5e1' },
  gemini: { bright: '#7dd3fc', base: '#38bdf8', deep: '#0e7490', glow: '#38bdf8' },
  opencode: { bright: '#93c5fd', base: '#60a5fa', deep: '#2563eb', glow: '#60a5fa' },
  archives: { bright: '#86efac', base: '#34d399', deep: '#047857', glow: '#34d399' },
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

const usagePageRanges: Array<{ value: UsagePageRange; label: string }> = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
]

const usageHeatmapMetrics: Array<{ value: UsageHeatmapMetric; label: string }> = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'cost', label: 'Cost' },
]

const usageTrendMetrics: Array<{ value: UsageTrendMetric; label: string }> = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: 'Cost' },
]

const usageTokenLabels: Record<UsageTokenType, string> = {
  input: 'Input Tokens',
  output: 'Output Tokens',
  cache: 'Cache Tokens',
  tools: 'Tool Tokens',
}

const usageTokenColors: Record<UsageTokenType, string> = {
  input: '#a78bfa',
  output: '#38bdf8',
  cache: '#fb923c',
  tools: '#4ade80',
}

const usagePeakColors = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#38bdf8', '#c084fc']
const usageHours = Array.from({ length: 24 }, (_, hour) => hour)
const usageDefaultMix: TokenMix = { input: 0.506, output: 0.36, cache: 0.106, tools: 0.028 }
const heatmapTimeLabels = ['00', '04', '08', '12', '16', '20', '24']

const tokenActivityModes: Array<{
  value: TokenActivityMode
  label: string
  icon: typeof ChartSpline
}> = [
  { value: 'bar', label: 'Bar', icon: ChartNoAxesColumn },
  { value: 'line', label: 'Linear', icon: ChartSpline },
  { value: 'heat', label: 'Heatmap', icon: Grid3X3 },
]

const storageViewModes: Array<{ value: StorageViewMode; label: string; icon: typeof Grid3X3 }> = [
  { value: 'pie', label: 'Pie', icon: Circle },
  { value: 'line', label: 'Line', icon: ListFilter },
  { value: 'layout', label: 'Layout', icon: Grid3X3 },
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
      style={
        { '--agent-color': sourceColors[source], color: sourceIconColors[source] } as AgentLogoStyle
      }
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

function UsageRangeControl({
  value,
  onChange,
}: {
  value: UsageRange
  onChange: (value: UsageRange) => void
}) {
  return (
    <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
      {usageRanges.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`h-6 rounded-md px-2 text-[11px] font-medium transition ${
            value === range.value
              ? 'bg-white/14 text-white shadow-sm'
              : 'text-white/45 hover:text-white/75'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}

function UsagePageRangeControl({
  value,
  onChange,
}: {
  value: UsagePageRange
  onChange: (value: UsagePageRange) => void
}) {
  return (
    <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
      {usagePageRanges.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`h-7 rounded-md px-3 text-xs font-medium transition ${
            value === range.value
              ? 'bg-white/14 text-white shadow-sm'
              : 'text-white/45 hover:text-white/75'
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

function usageDaysForRange(_usage: UsagePoint[], range: UsageRange): number {
  return range === 'all' ? 365 : range
}

function sessionCountForDates(sessions: SessionRecord[], dates: Set<string>): number {
  return sessions.filter((session) =>
    dates.has(dateKeyFromTime(new Date(session.lastUpdated).getTime())),
  ).length
}

function cleanupCountForDates(cleanup: CleanupCandidate[], dates: Set<string>): number {
  return cleanup.filter(
    (item) => item.lastUpdated && dates.has(dateKeyFromTime(new Date(item.lastUpdated).getTime())),
  ).length
}

function usageTotalForDates(snapshot: DashboardSnapshot, dates: Set<string>): number {
  return snapshot.usage.reduce(
    (total, point) => total + (dates.has(point.date) ? point.total : 0),
    0,
  )
}

function sessionTokenTotalForDates(sessions: SessionRecord[], dates: Set<string>): number {
  return sessions.reduce((total, session) => {
    const usageByDate = session.metadata.usageByDate
    if (usageByDate && typeof usageByDate === 'object' && !Array.isArray(usageByDate)) {
      return (
        total +
        Object.entries(usageByDate).reduce((sum, [date, value]) => {
          return (
            sum +
            (dates.has(date) && typeof value === 'number' && Number.isFinite(value) ? value : 0)
          )
        }, 0)
      )
    }

    return dates.has(dateKeyFromTime(new Date(session.lastUpdated).getTime()))
      ? total + session.tokens.total
      : total
  }, 0)
}

function trendDetail(current: number, previous: number, unit: string, range: UsageRange): string {
  if (range === 'all')
    return current === 0 ? `No ${unit} all time` : `${current.toLocaleString()} ${unit} all time`
  if (current === 0 && previous === 0) return `No ${unit} in ${range} days`
  if (previous <= 0) return `${current.toLocaleString()} ${unit} in ${range} days`
  const delta = ((current - previous) / previous) * 100
  const direction = delta >= 0 ? '+' : ''
  return `${direction}${delta.toFixed(0)}% vs prior ${range}d`
}

function rangeDateKeys(usage: UsagePoint[], range: UsageRange): Set<string> {
  const days = usageDaysForRange(usage, range)
  return new Set(usage.slice(-days).map((point) => point.date))
}

function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.min(9, Math.max(1, Math.ceil((value / max) * 9)))
}

function heatmapLabelEvery(days: number): number {
  if (days <= 7) return 1
  if (days <= 14) return 2
  return 3
}

function buildHeatmapCells(usage: UsagePoint[]): HeatmapCell[] {
  const cellValues = usage.flatMap((point, dayIndex) => {
    const column = dayIndex + 1
    return Array.from({ length: heatmapTimeLabels.length }, (_, rowIndex) => {
      const source = agentSources[(rowIndex + dayIndex) % agentSources.length]
      const neighbor = agentSources[(rowIndex + dayIndex + 2) % agentSources.length]
      const rowWave = 0.78 + ((dayIndex + rowIndex * 3) % 7) * 0.055
      const rowValue = (point[source] * 0.72 + point[neighbor] * 0.28) * rowWave
      return {
        date: point.date,
        day: heatmapTimeLabels[rowIndex],
        value: rowValue,
        gridColumn: column,
        gridRow: rowIndex + 1,
      }
    })
  })
  const max = Math.max(...cellValues.map((cell) => cell.value), 0)
  return cellValues.map((cell) => ({
    ...cell,
    level: heatLevel(cell.value, max),
  }))
}

function UsageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: ChartTooltipPayload[]
  label?: unknown
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const sources = agentSources
    .map((source) => ({ source, value: point?.[source] ?? 0 }))
    .filter((item) => item.value > 0)
  const total = Number(
    payload.find((item) => item.dataKey === 'total')?.value ??
      point?.total ??
      sources.reduce((sum, item) => sum + item.value, 0),
  )

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
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: sourceColors[item.source] }}
                />
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
  heatmapUsage,
}: {
  usage: UsagePoint[]
  heatmapUsage: UsagePoint[]
}) {
  const [mode, setMode] = useState<TokenActivityMode>('bar')
  const heatUsageDays = Math.min(30, heatmapUsage.length)
  const minWidth = mode === 'heat' ? Math.max(620, 72 + heatUsageDays * 21) : 580

  return (
    <Card className="glass-panel token-activity-card rounded-lg py-4" style={{ minWidth }}>
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
                          mode === activityMode.value
                            ? 'bg-white/14 text-white shadow-sm'
                            : 'text-white/45 hover:text-white/75'
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
        {mode === 'heat' && <TokenHeatmap usage={heatmapUsage} />}
      </CardContent>
    </Card>
  )
}

function TokenLineChart({ usage }: { usage: UsagePoint[] }) {
  return (
    <ResponsiveContainer className="chart-static" width="100%" height="100%">
      <LineChart
        data={usage}
        accessibilityLayer={false}
        margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <filter id="tokenLineGlow" x="-12%" y="-70%" width="124%" height="240%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="1.25"
              floodColor="#60a5fa"
              floodOpacity="0.36"
            />
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="0.45"
              floodColor="#93c5fd"
              floodOpacity="0.22"
            />
          </filter>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={18}
          tickFormatter={(value) => String(value).slice(5)}
        />
        <YAxis
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => formatTokens(Number(value))}
        />
        <ChartTooltip
          content={<UsageTooltip />}
          cursor={{ stroke: 'rgba(147,197,253,.38)', strokeWidth: 1, strokeDasharray: '4 5' }}
          wrapperStyle={{ outline: 'none' }}
        />
        <Line
          type="monotone"
          dataKey="total"
          stroke="#60a5fa"
          strokeWidth={2.2}
          dot={false}
          activeDot={{ r: 4, fill: '#60a5fa', stroke: 'rgba(248,251,255,.82)', strokeWidth: 2 }}
          filter="url(#tokenLineGlow)"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function TokenBarChart({ usage }: { usage: UsagePoint[] }) {
  return (
    <ResponsiveContainer className="chart-static" width="100%" height="100%">
      <BarChart
        data={usage}
        accessibilityLayer={false}
        margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          {agentSources.map((source) => {
            const colors = tokenBarGlowColors[source]
            return (
              <linearGradient
                key={`tokenBarGradient-${source}`}
                id={`tokenBarGradient-${source}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={colors.bright} stopOpacity={0.98} />
                <stop offset="42%" stopColor={colors.base} stopOpacity={0.98} />
                <stop offset="100%" stopColor={colors.deep} stopOpacity={0.96} />
              </linearGradient>
            )
          })}
          {agentSources.map((source) => {
            const colors = tokenBarGlowColors[source]
            return (
              <filter
                key={`tokenBarGlow-${source}`}
                id={`tokenBarGlow-${source}`}
                x="-35%"
                y="-35%"
                width="170%"
                height="190%"
              >
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="1.1"
                  floodColor={colors.glow}
                  floodOpacity="0.24"
                />
                <feDropShadow
                  dx="0"
                  dy="-1"
                  stdDeviation="0.55"
                  floodColor={colors.bright}
                  floodOpacity="0.16"
                />
              </filter>
            )
          })}
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={18}
          tickFormatter={(value) => String(value).slice(5)}
        />
        <YAxis
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => formatTokens(Number(value))}
        />
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
            fill={`url(#tokenBarGradient-${source})`}
            filter={`url(#tokenBarGlow-${source})`}
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function TokenHeatmap({ usage }: { usage: UsagePoint[] }) {
  const heatmapUsage = usage.slice(-30)
  const cells = buildHeatmapCells(heatmapUsage)
  const labelEvery = heatmapLabelEvery(heatmapUsage.length)
  const dateLabels = heatmapUsage
    .map((point, index) => ({ point, index }))
    .filter(
      ({ index }) => index === 0 || index === heatmapUsage.length - 1 || index % labelEvery === 0,
    )

  return (
    <div className="flex h-full flex-col justify-center">
      <div
        className="token-heatmap-grid"
        style={{ gridTemplateColumns: `36px repeat(${heatmapUsage.length}, 16px)` }}
      >
        {heatmapTimeLabels.map((time, index) => (
          <div
            key={time}
            className="self-center text-[11px] text-white/42"
            style={{ gridColumn: 1, gridRow: index + 1 }}
          >
            {time}
          </div>
        ))}
        {cells.map((cell) => (
          <Tooltip key={`${cell.date}-${cell.gridRow}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${cell.date} ${cell.day}:00: ${formatTokens(cell.value)} tokens`}
                className="token-heatmap-cell"
                data-level={cell.level}
                style={{ gridColumn: cell.gridColumn + 1, gridRow: cell.gridRow }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {cell.date} {cell.day}:00 · {formatTokens(cell.value)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div
        className="token-heatmap-axis mt-3 grid pl-9 text-[11px] text-white/38"
        style={{ gridTemplateColumns: `repeat(${heatmapUsage.length}, 16px)` }}
      >
        {dateLabels.map(({ point, index }) => (
          <span key={point.date} style={{ gridColumn: index + 1 }}>
            {point.date.slice(5)}
          </span>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-white/42">
        <span>Low activity</span>
        {Array.from({ length: 9 }, (_, index) => (
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

function storageVisualStyle(source: AgentSource | 'archives'): StorageVisualStyle {
  const colors = tokenBarGlowColors[source]
  return {
    '--storage-color': colors.base,
    '--storage-bright': colors.bright,
    '--storage-deep': colors.deep,
    '--storage-glow': colors.glow,
  }
}

function StorageSummaryBody({ slice, total }: { slice: StorageDatum; total: number }) {
  return (
    <div className="min-w-40 space-y-1">
      <div className="flex items-center gap-2 text-xs font-medium text-white/58">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: storageSourceColors[slice.source] }}
        />
        <span className="truncate">{slice.name}</span>
      </div>
      <div className="flex items-center justify-between gap-7 text-[11px]">
        <span className="text-white/50">Storage</span>
        <span className="font-mono font-semibold text-blue-300">{formatBytes(slice.value)}</span>
      </div>
      <div className="flex items-center justify-between gap-7 text-[11px]">
        <span className="text-white/50">Share</span>
        <span className="font-mono font-semibold text-white/64">
          {storagePercent(slice.value, total)}
        </span>
      </div>
    </div>
  )
}

function StorageSummaryTooltip({ slice, total }: { slice: StorageDatum; total: number }) {
  return (
    <TooltipContent
      side="top"
      sideOffset={8}
      className="chart-tooltip rounded-lg px-3 py-2 shadow-xl"
    >
      <StorageSummaryBody slice={slice} total={total} />
    </TooltipContent>
  )
}

function StorageChartTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean
  payload?: StorageChartTooltipPayload[]
  total: number
}) {
  const slice = payload?.[0]?.payload
  if (!active || !slice) return null

  return (
    <div className="chart-tooltip rounded-lg px-3 py-2 shadow-xl">
      <StorageSummaryBody slice={slice} total={total} />
    </div>
  )
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
  const subtitle = mode === 'line' ? 'By source' : undefined

  return (
    <Card className="glass-panel flex h-[318px] flex-col overflow-hidden rounded-lg py-4">
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
                        mode === viewMode.value
                          ? 'bg-white/14 text-white shadow-sm'
                          : 'text-white/45 hover:text-white/75'
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
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        {mode === 'layout' && (
          <StorageLayoutView storageData={storageData} storageTotal={storageTotal} />
        )}
        {mode === 'line' && (
          <StorageLineView
            storageData={storageData}
            storageTotal={storageTotal}
            sessionCount={sessionCount}
          />
        )}
        {mode === 'pie' && (
          <StoragePieView
            storageData={storageData}
            storageTotal={storageTotal}
            sessionCount={sessionCount}
          />
        )}
      </CardContent>
    </Card>
  )
}

function StorageLayoutView({
  storageData,
  storageTotal,
}: {
  storageData: StorageDatum[]
  storageTotal: number
}) {
  if (storageData.length === 0) {
    return (
      <div className="grid h-full place-items-center text-xs text-white/45">
        No storage activity in this range
      </div>
    )
  }

  const [primary, secondary, ...rest] = storageData

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="storage-layout-grid min-h-0 flex-1">
        {primary && (
          <StorageLayoutTile
            slice={primary}
            total={storageTotal}
            className="storage-layout-primary"
          />
        )}
        {secondary && (
          <StorageLayoutTile
            slice={secondary}
            total={storageTotal}
            className="storage-layout-secondary"
          />
        )}
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

function StorageLayoutTile({
  slice,
  total,
  className = '',
}: {
  slice: StorageDatum
  total: number
  className?: string
}) {
  const percent = total > 0 ? (slice.value / total) * 100 : 0
  const density = percent < 1 ? 'tiny' : percent < 6 ? 'compact' : 'full'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`storage-layout-tile ${className}`}
          data-source={slice.source}
          data-density={density}
          style={storageVisualStyle(slice.source)}
        >
          <div className="relative z-10 min-w-0">
            <div className="storage-layout-label truncate text-[13px] font-semibold text-white/88">
              {slice.name}
            </div>
            {density !== 'tiny' && (
              <div className="mt-1 text-xs font-medium text-white/62">
                {formatBytes(slice.value)}
              </div>
            )}
            {density === 'full' && (
              <div className="mt-0.5 text-xs font-semibold text-white/52">
                {storagePercent(slice.value, total)}
              </div>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <StorageSummaryTooltip slice={slice} total={total} />
    </Tooltip>
  )
}

function StorageLegend({
  storageData,
  storageTotal,
}: {
  storageData: StorageDatum[]
  storageTotal: number
}) {
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden">
      {storageData.slice(0, 5).map((slice) => (
        <div
          key={slice.source}
          className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-white/45"
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: storageSourceColors[slice.source] }}
          />
          <span className="truncate">
            {slice.name} ({storagePercent(slice.value, storageTotal)})
          </span>
        </div>
      ))}
    </div>
  )
}

function StorageLineView({
  storageData,
  storageTotal,
  sessionCount,
}: {
  storageData: StorageDatum[]
  storageTotal: number
  sessionCount: number
}) {
  return (
    <div className="storage-line-view flex h-full flex-col gap-3 overflow-y-auto pr-1">
      {storageData.length === 0 && (
        <div className="text-xs text-white/45">No storage activity in this range</div>
      )}
      {storageData.slice(0, 5).map((slice) => (
        <Tooltip key={slice.source}>
          <TooltipTrigger asChild>
            <div className="storage-line-row grid grid-cols-[112px_1fr_72px] items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: storageSourceColors[slice.source] }}
                />
                <span className="truncate text-[13px] font-medium text-white/70">{slice.name}</span>
              </div>
              <div
                className="storage-meter"
                style={
                  {
                    ...storageVisualStyle(slice.source),
                    '--meter-value': `${(slice.value / Math.max(storageTotal, 1)) * 100}%`,
                  } as StorageVisualStyle & { '--meter-value': string }
                }
              >
                <span className="storage-meter-fill" />
              </div>
              <span className="shrink-0 text-right text-[13px] font-semibold text-white/58">
                {formatBytes(slice.value)}
              </span>
            </div>
          </TooltipTrigger>
          <StorageSummaryTooltip slice={slice} total={storageTotal} />
        </Tooltip>
      ))}
      {storageTotal > 0 && (
        <div className="mt-1 grid grid-cols-[112px_1fr_72px] items-center gap-3 border-t border-white/7 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <Database className="size-4 text-blue-300" />
            <span className="text-[13px] font-semibold text-white/70">Total</span>
          </div>
          <span className="text-[11px] text-white/35">
            {sessionCount.toLocaleString()} sessions
          </span>
          <span className="text-right text-[13px] font-semibold text-white/64">
            {formatBytes(storageTotal)}
          </span>
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
          <defs>
            <filter id="storagePieHalo" x="-45%" y="-45%" width="190%" height="190%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .31 0"
              />
            </filter>
            {storageSources.map((source) => {
              const colors = tokenBarGlowColors[source]
              return (
                <linearGradient
                  key={`storagePieGradient-${source}`}
                  id={`storagePieGradient-${source}`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop offset="0%" stopColor={colors.bright} stopOpacity={0.98} />
                  <stop offset="58%" stopColor={colors.base} stopOpacity={0.98} />
                  <stop offset="100%" stopColor={colors.deep} stopOpacity={0.96} />
                </linearGradient>
              )
            })}
          </defs>
          <ChartTooltip
            content={<StorageChartTooltip total={storageTotal} />}
            wrapperStyle={{ outline: 'none' }}
          />
          <Pie
            data={storageData}
            innerRadius={42}
            outerRadius={76}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
            stroke="none"
            filter="url(#storagePieHalo)"
            opacity={0.29}
          >
            {storageData.map((entry) => (
              <Cell key={`halo-${entry.name}`} fill={storageSourceColors[entry.source]} />
            ))}
          </Pie>
          <Pie
            data={storageData}
            innerRadius={44}
            outerRadius={72}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
            stroke="rgba(255,255,255,.32)"
            strokeWidth={0.7}
          >
            {storageData.map((entry) => (
              <Cell
                key={entry.name}
                fill={`url(#storagePieGradient-${entry.source})`}
                stroke="rgba(255,255,255,.32)"
                strokeWidth={0.7}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-3">
        {storageData.length === 0 && (
          <div className="text-xs text-white/45">No storage activity in this range</div>
        )}
        {storageData.slice(0, 5).map((slice) => (
          <div
            key={`${slice.source}-${slice.name}`}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: storageSourceColors[slice.source] }}
              />
              <span className="truncate text-white/70">{slice.name}</span>
            </div>
            <span className="text-white/48">{formatBytes(slice.value)}</span>
          </div>
        ))}
        {storageTotal > 0 && (
          <div className="border-t border-white/7 pt-2 text-[11px] text-white/38">
            {formatBytes(storageTotal)} across {sessionCount.toLocaleString()} sessions
          </div>
        )}
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
        <img
          src="/app-logo.png"
          alt=""
          className="size-10 shrink-0 object-contain"
          draggable={false}
        />
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
                active
                  ? 'bg-white/11 text-white shadow-inner'
                  : 'text-white/66 hover:bg-white/7 hover:text-white'
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
          <div
            key={agent.source}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-white/70"
          >
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
        <p className="mt-2 text-[11px] leading-4 text-white/42">
          Cleanup moves files to app Trash. Session candidates are backed up first.
        </p>
      </div>
    </aside>
  )
}

function Topbar({
  activeView,
  loading,
  mockDataEnabled,
  overviewRange,
  usageRange,
  resolvedTheme,
  onThemeToggle,
  onOverviewRangeChange,
  onUsageRangeChange,
  onUsageExport,
  onRescan,
}: {
  activeView: ViewId
  loading: boolean
  mockDataEnabled: boolean
  overviewRange: UsageRange
  usageRange: UsagePageRange
  resolvedTheme: 'light' | 'dark'
  onThemeToggle: () => void
  onOverviewRangeChange: (range: UsageRange) => void
  onUsageRangeChange: (range: UsagePageRange) => void
  onUsageExport: () => void
  onRescan: () => Promise<void>
}) {
  const title = navItems.find((item) => item.id === activeView)?.label ?? 'Overview'
  const ThemeIcon = resolvedTheme === 'dark' ? Sun : Moon
  const nextThemeLabel = resolvedTheme === 'dark' ? 'light' : 'dark'
  const subtitle =
    activeView === 'usage'
      ? 'Detailed token, cost, and session analytics across local AI agents.'
      : activeView === 'cleanup'
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
          <Badge
            variant="outline"
            className="border-violet-300/20 bg-violet-400/10 text-violet-200"
          >
            Demo
          </Badge>
        )}
        {activeView === 'overview' && (
          <UsageRangeControl value={overviewRange} onChange={onOverviewRangeChange} />
        )}
        {activeView === 'usage' && (
          <>
            <UsagePageRangeControl value={usageRange} onChange={onUsageRangeChange} />
            <Button
              variant="outline"
              size="sm"
              onClick={onUsageExport}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              <Download className="size-3.5" />
              Export
            </Button>
          </>
        )}
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
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onRescan()}
              disabled={loading}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
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
  loading,
  onRefresh,
  onSelectCleanup,
}: {
  snapshot: DashboardSnapshot
  usageRange: UsageRange
  loading: boolean
  onRefresh: () => Promise<void>
  onSelectCleanup: () => void
}) {
  const recentSessions = snapshot.sessions.slice(0, 6)
  const rangeDays = usageDaysForRange(snapshot.usage, usageRange)
  const currentRangeDates =
    usageRange === 'all' ? rangeDateKeys(snapshot.usage, usageRange) : recentDateKeys(rangeDays)
  const priorRangeDates =
    usageRange === 'all' ? new Set<string>() : recentDateKeys(rangeDays, rangeDays)
  const sessionsInRange = sessionCountForDates(snapshot.sessions, currentRangeDates)
  const sessionsPriorRange = sessionCountForDates(snapshot.sessions, priorRangeDates)
  const backupsInRange = snapshot.backups.filter((backup) =>
    currentRangeDates.has(dateKeyFromTime(new Date(backup.createdAt).getTime())),
  ).length
  const backupsPriorRange = snapshot.backups.filter((backup) =>
    priorRangeDates.has(dateKeyFromTime(new Date(backup.createdAt).getTime())),
  ).length
  const cleanupInRange = cleanupCountForDates(snapshot.cleanup, currentRangeDates)
  const cleanupPriorRange = cleanupCountForDates(snapshot.cleanup, priorRangeDates)
  const tokensInRange =
    sessionTokenTotalForDates(snapshot.sessions, currentRangeDates) ||
    usageTotalForDates(snapshot, currentRangeDates)
  const tokensPriorRange =
    sessionTokenTotalForDates(snapshot.sessions, priorRangeDates) ||
    usageTotalForDates(snapshot, priorRangeDates)
  const rangeUsage = snapshot.usage.slice(-rangeDays)
  const selectedDateKeys = rangeDateKeys(snapshot.usage, usageRange)
  const rangeSessions = snapshot.sessions.filter((session) =>
    selectedDateKeys.has(dateKeyFromTime(new Date(session.lastUpdated).getTime())),
  )
  const storageData = snapshot.storage
    .filter((slice) => agentSources.includes(slice.source as AgentSource))
    .map((slice) => ({
      name: slice.label,
      value: slice.sizeBytes,
      source: slice.source as AgentSource,
      sessions: slice.sessions ?? 0,
    }))
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value)
  const storageTotal = storageData.reduce((total, slice) => total + slice.value, 0)

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-4 gap-3">
        <MetricCard
          icon={Database}
          label="Total Sessions"
          value={snapshot.overview.totalSessions.toLocaleString()}
          detail={trendDetail(sessionsInRange, sessionsPriorRange, 'sessions', usageRange)}
          accent="bg-emerald-400/12 text-emerald-300"
        />
        <MetricCard
          icon={Archive}
          label="Backed Up"
          value={snapshot.overview.backedUpSessions.toLocaleString()}
          detail={trendDetail(backupsInRange, backupsPriorRange, 'backups', usageRange)}
          accent="bg-blue-400/12 text-blue-300"
        />
        <MetricCard
          icon={HardDrive}
          label="Reclaimable"
          value={formatBytes(snapshot.overview.reclaimableBytes)}
          detail={trendDetail(cleanupInRange, cleanupPriorRange, 'suggestions', usageRange)}
          accent="bg-amber-400/12 text-amber-300"
        />
        <MetricCard
          icon={Gauge}
          label="Token Usage"
          value={formatTokens(snapshot.overview.totalTokens)}
          detail={trendDetail(tokensInRange, tokensPriorRange, 'tokens', usageRange)}
          accent="bg-violet-400/12 text-violet-300"
        />
      </section>

      <section className="grid grid-cols-[1fr_400px] gap-4">
        <TokenActivityCard usage={rangeUsage} heatmapUsage={snapshot.usage} />
        <StorageBreakdownCard
          storageData={storageData}
          storageTotal={storageTotal}
          sessionCount={rangeSessions.length}
        />
      </section>

      <section className="grid grid-cols-[1fr_400px] gap-4">
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0">
            <div className="flex w-full items-center justify-between">
              <CardTitle className="text-sm text-white">Recent Sessions</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onRefresh()}
                disabled={loading}
                className="text-blue-300 hover:bg-blue-400/10 hover:text-blue-200"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3.5" />
                )}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-white/7">
              {recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="grid grid-cols-[28px_1fr_120px_80px_80px] items-center gap-3 py-2.5 text-xs"
                >
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
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelectCleanup}
                className="text-blue-300 hover:bg-blue-400/10 hover:text-blue-200"
              >
                Review
              </Button>
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
      <div
        className={`grid size-8 place-items-center rounded-md ring-1 ${riskAccent[candidate.risk]}`}
      >
        <Trash2 className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-white/82">{candidate.title}</div>
        <div className="truncate text-[11px] text-white/38">{candidate.reason}</div>
      </div>
      <div className="text-right text-xs font-semibold text-amber-300">
        {formatBytes(candidate.sizeBytes)}
      </div>
    </div>
  )
}

function SessionsView({
  sessions,
  archives,
  initialQuery = '',
  onBackup,
  onArchive,
  onRestoreArchive,
  onExport,
  onRelay,
}: {
  sessions: SessionRecord[]
  archives: ArchiveRecord[]
  initialQuery?: string
  onBackup: (sessionId: string) => Promise<void>
  onArchive: (sessionId: string) => Promise<void>
  onRestoreArchive: (archiveId: string) => Promise<void>
  onExport: (sessionId: string) => Promise<void>
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [query, setQuery] = useState(initialQuery)
  const [agent, setAgent] = useState<'all' | AgentSource>('all')
  const archivesBySessionId = new Map(archives.map((archive) => [archive.sessionId, archive]))
  const filtered = sessions.filter((session) => {
    const haystack = [
      session.title,
      session.projectName,
      session.projectPath,
      session.branch,
      agentLabel[session.source],
      session.storageState,
      session.searchText,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return (
      haystack.includes(query.trim().toLowerCase()) && (agent === 'all' || session.source === agent)
    )
  })

  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm text-white">Unified Sessions</CardTitle>
            <p className="mt-1 text-xs text-white/42">
              Codex, Claude Code, Cursor, Gemini, and OpenCode sessions in one index.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/35" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sessions and previews..."
                className="h-8 w-64 border-white/10 bg-white/5 pl-8 text-white placeholder:text-white/30"
              />
            </div>
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value as 'all' | AgentSource)}
              className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none"
            >
              <option value="all">All Agents</option>
              {Object.entries(agentLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
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
                <TableHead className="text-white/45">State</TableHead>
                <TableHead className="text-right text-white/45">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 80).map((session) => {
                const archive = archivesBySessionId.get(session.id)
                return (
                  <TableRow key={session.id} className="border-white/7 hover:bg-white/[0.035]">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <AgentGlyph source={session.source} />
                        <span className="text-xs text-white/70">{agentLabel[session.source]}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate font-medium text-white/82">
                      {session.title}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-white/55">
                      {session.projectName}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-white/45">
                      {session.branch ?? 'Unknown'}
                    </TableCell>
                    <TableCell className="text-white/45">
                      {formatRelative(session.lastUpdated)}
                    </TableCell>
                    <TableCell className="text-right text-white/60">
                      {formatTokens(session.tokens.total)}
                    </TableCell>
                    <TableCell className="text-right text-white/60">
                      {formatBytes(session.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      {session.storageState === 'archived' ? (
                        <Badge className="bg-emerald-400/10 text-emerald-300">
                          <Archive className="size-3" />
                          Vault
                        </Badge>
                      ) : session.backupStatus === 'backed-up' ? (
                        <Badge className="bg-blue-400/10 text-blue-300">
                          <CheckCircle2 className="size-3" />
                          Live
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-400/20 bg-amber-400/10 text-amber-300"
                        >
                          Live
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void onBackup(session.id)}
                              disabled={session.storageState === 'archived'}
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              <Archive className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Backup session</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                session.storageState === 'archived' && archive
                                  ? void onRestoreArchive(archive.id)
                                  : void onArchive(session.id)
                              }
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              {session.storageState === 'archived' ? (
                                <RefreshCcw className="size-3.5" />
                              ) : (
                                <HardDrive className="size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {session.storageState === 'archived'
                              ? 'Restore from Vault'
                              : 'Archive to Vault'}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void onExport(session.id)}
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              <Download className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Export Markdown</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void onRelay(session.id)}
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              <FileJson2 className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Export universal relay JSON</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

type CleanupStage = 'idle' | 'scanning' | 'complete' | 'review'
type CleanupScanStage = Exclude<CleanupStage, 'review'>
type CleanupOrbPhase = 'initial' | 'scalein' | 'running' | 'scaleout' | 'finish'
type CleanupFilter = 'all' | 'high' | 'medium' | 'low' | 'recoverable'
type CleanupSort = 'size' | 'risk' | 'agent'
type CleanupSourceProgress = {
  source: AgentSource
  scanned: number
  total: number
  status: 'Waiting' | 'Scanning' | 'Complete'
}
type CleanupCategoryKey = 'large' | 'inactive' | 'test'
type CleanupCategorySummary = {
  key: CleanupCategoryKey
  title: string
  description: string
  bytes: number
  count: number
  action: 'Recommended' | 'Review' | 'Safe'
  icon: typeof Activity
  accent: string
}
type CleanupWorkspaceHint = {
  key: string
  label: string
  detail: string
}
type CleanupCandidateGroup = {
  id: string
  source: AgentSource
  workspace: CleanupWorkspaceHint
  candidates: CleanupCandidate[]
  bytes: number
  latestOpened?: string
}
type CleanupPersistedViewState = {
  stage: 'complete'
  savedAt: string
  candidateIds: string[]
}

type CleanupViewProps = {
  cleanup: CleanupCandidate[]
  agents: DashboardSnapshot['agents']
  sessions: SessionRecord[]
  onScanCleanup: () => Promise<CleanupCandidate[]>
  onMoveToTrash: (candidateIds: string[]) => Promise<void>
}

const cleanupSourceWeights: Record<AgentSource, { start: number; end: number }> = {
  codex: { start: 0, end: 24 },
  claude: { start: 12, end: 48 },
  cursor: { start: 34, end: 72 },
  gemini: { start: 52, end: 88 },
  opencode: { start: 72, end: 100 },
}

const cleanupRiskRank: Record<CleanupCandidate['risk'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

const cleanupOrbMorphTransition = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1],
} as const
const cleanupOrbMaxSize = 320
const cleanupOrbMinSize = 248
const cleanupScanningOrbScale = 250 / cleanupOrbMaxSize
const cleanupMaxVisibleGroupSessions = 80

const cleanupViewStateStorageKey = 'clean-my-agent.cleanupViewState'

const cleanupBodyTransition = {
  duration: 0.42,
  ease: [0.22, 1, 0.36, 1],
} as const

const cleanupBodyVariants = {
  initial: { opacity: 0, y: 18, filter: 'blur(5px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -14, filter: 'blur(4px)' },
} as const

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function initialCleanupStageSize() {
  if (typeof window === 'undefined') return { width: 960, height: 720 }
  return {
    width: Math.max(640, window.innerWidth - 232),
    height: Math.max(520, window.innerHeight - 64),
  }
}

function readCleanupViewState(): CleanupPersistedViewState | null {
  try {
    const raw = globalThis.localStorage?.getItem(cleanupViewStateStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CleanupPersistedViewState>
    if (parsed.stage !== 'complete') return null
    return {
      stage: parsed.stage,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      candidateIds: Array.isArray(parsed.candidateIds)
        ? parsed.candidateIds.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch (error) {
    console.error(error)
    return null
  }
}

function writeCleanupViewState(candidates: CleanupCandidate[]) {
  try {
    globalThis.localStorage?.setItem(
      cleanupViewStateStorageKey,
      JSON.stringify({
        stage: 'complete',
        savedAt: new Date().toISOString(),
        candidateIds: candidates.map((candidate) => candidate.id),
      } satisfies CleanupPersistedViewState),
    )
  } catch (error) {
    console.error(error)
  }
}

function clearCleanupViewState() {
  try {
    globalThis.localStorage?.removeItem(cleanupViewStateStorageKey)
  } catch (error) {
    console.error(error)
  }
}

const cleanupKindMeta: Record<
  CleanupCandidate['kind'],
  { category: CleanupCategoryKey; label: string; icon: typeof Activity; accent: string }
> = {
  'old-session': {
    category: 'inactive',
    label: 'old session',
    icon: CalendarDays,
    accent: 'text-sky-300 bg-sky-400/12 ring-sky-400/22',
  },
  'backed-up-session': {
    category: 'inactive',
    label: 'old session',
    icon: CalendarDays,
    accent: 'text-emerald-300 bg-emerald-400/12 ring-emerald-400/22',
  },
  'large-log': {
    category: 'large',
    label: 'large chat',
    icon: MessageSquare,
    accent: 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/24',
  },
  'duplicate-backup': {
    category: 'test',
    label: 'recoverable',
    icon: Archive,
    accent: 'text-blue-300 bg-blue-400/12 ring-blue-400/24',
  },
  'temp-file': {
    category: 'test',
    label: 'test chat',
    icon: FlaskConical,
    accent: 'text-violet-300 bg-violet-400/13 ring-violet-400/24',
  },
  'orphan-session': {
    category: 'inactive',
    label: 'old session',
    icon: Clock,
    accent: 'text-amber-300 bg-amber-400/13 ring-amber-400/24',
  },
  'invalid-cache': {
    category: 'test',
    label: 'test chat',
    icon: FlaskConical,
    accent: 'text-red-300 bg-red-400/12 ring-red-400/24',
  },
}

function cleanupCategoryForCandidate(candidate: CleanupCandidate): CleanupCategoryKey {
  return cleanupKindMeta[candidate.kind].category
}

function defaultCleanupSelection(candidates: CleanupCandidate[]): string[] {
  return candidates
    .filter((candidate) => {
      const category = cleanupCategoryForCandidate(candidate)
      return category === 'inactive' || category === 'test'
    })
    .map((candidate) => candidate.id)
}

function cleanupTimestamp(value: string | undefined): number {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function cleanupSessionForCandidate(
  candidate: CleanupCandidate,
  sessionById: Map<string, SessionRecord>,
): SessionRecord | undefined {
  for (const sessionId of candidate.sessionIds) {
    const session = sessionById.get(sessionId)
    if (session) return session
  }
  return undefined
}

function cleanupDirectoryFromPath(pathValue: string): string {
  const normalized = pathValue.replaceAll('\\', '/').replace(/\/+/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return normalized || 'Unknown path'

  const lastPart = parts.at(-1) ?? ''
  const looksLikeFile = /\.[a-z0-9]{1,12}$/i.test(lastPart)
  const directoryParts = looksLikeFile ? parts.slice(0, -1) : parts
  if (directoryParts.length === 0) return normalized

  const prefix = normalized.startsWith('/') ? '/' : ''
  return `${prefix}${directoryParts.join('/')}`
}

function cleanupCompactPath(pathValue: string, maxLength = 72): string {
  if (pathValue.length <= maxLength) return pathValue
  const headLength = Math.max(18, Math.floor(maxLength * 0.38))
  const tailLength = Math.max(24, maxLength - headLength - 3)
  return `${pathValue.slice(0, headLength)}...${pathValue.slice(-tailLength)}`
}

function cleanupPathLabel(pathValue: string): string {
  const normalized = pathValue.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return 'Unknown workspace'
  return parts.slice(-2).join('/')
}

function cleanupWorkspaceForCandidate(
  candidate: CleanupCandidate,
  session: SessionRecord | undefined,
): CleanupWorkspaceHint {
  if (session?.projectPath) {
    return {
      key: session.projectPath,
      label: session.projectName || cleanupPathLabel(session.projectPath),
      detail: session.projectPath,
    }
  }

  if (session?.projectName) {
    return {
      key: `project:${session.projectName}`,
      label: session.projectName,
      detail: 'Project name only',
    }
  }

  const primaryPath = candidate.paths[0]
  if (!primaryPath) {
    return {
      key: 'unknown',
      label: 'Unknown workspace',
      detail: 'No local path available',
    }
  }

  const directory = cleanupDirectoryFromPath(primaryPath)
  return {
    key: directory,
    label: cleanupPathLabel(directory),
    detail: directory,
  }
}

function cleanupCandidateSource(
  candidate: CleanupCandidate,
  session: SessionRecord | undefined,
): AgentSource {
  return candidate.source ?? session?.source ?? 'codex'
}

function buildCleanupCandidateGroups(
  candidates: CleanupCandidate[],
  sessionById: Map<string, SessionRecord>,
): CleanupCandidateGroup[] {
  const groups = new Map<string, CleanupCandidateGroup>()

  for (const candidate of candidates) {
    const session = cleanupSessionForCandidate(candidate, sessionById)
    const source = cleanupCandidateSource(candidate, session)
    const workspace = cleanupWorkspaceForCandidate(candidate, session)
    const id = `${source}:${workspace.key}`
    const existing =
      groups.get(id) ??
      ({
        id,
        source,
        workspace,
        candidates: [],
        bytes: 0,
      } satisfies CleanupCandidateGroup)

    existing.candidates.push(candidate)
    existing.bytes += candidate.sizeBytes

    const currentLatest = cleanupTimestamp(existing.latestOpened)
    const candidateLatest = cleanupTimestamp(candidate.lastUpdated)
    if (candidateLatest > currentLatest) existing.latestOpened = candidate.lastUpdated

    groups.set(id, existing)
  }

  return Array.from(groups.values()).sort((a, b) => {
    const sourceDelta = agentSources.indexOf(a.source) - agentSources.indexOf(b.source)
    if (sourceDelta !== 0) return sourceDelta
    if (b.bytes !== a.bytes) return b.bytes - a.bytes
    return a.workspace.label.localeCompare(b.workspace.label)
  })
}

function CleanupView({
  cleanup,
  agents,
  sessions,
  onScanCleanup,
  onMoveToTrash,
}: CleanupViewProps) {
  const [persistedState] = useState(() => readCleanupViewState())
  const [stage, setStage] = useState<CleanupStage>(() => persistedState?.stage ?? 'idle')
  const [orbPhase, setOrbPhase] = useState<CleanupOrbPhase>(() =>
    persistedState ? 'finish' : 'initial',
  )
  const [progress, setProgress] = useState(() => (persistedState ? 100 : 0))
  const [localCleanup, setLocalCleanup] = useState<CleanupCandidate[] | null>(null)
  const [selected, setSelected] = useState<string[]>(() =>
    persistedState ? defaultCleanupSelection(cleanup) : [],
  )
  const [filter, setFilter] = useState<CleanupFilter>('all')
  const [sort, setSort] = useState<CleanupSort>('size')
  const [cleaning, setCleaning] = useState(false)
  const [cleaningIds, setCleaningIds] = useState<string[]>([])
  const [cleaned, setCleaned] = useState(false)
  const scanRunRef = useRef(0)
  const visibleCleanup = localCleanup ?? cleanup
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )

  const sourceTotals = useMemo(
    () =>
      agentSources.reduce(
        (acc, source) => {
          const agent = agents.find((item) => item.source === source)
          const sourceCandidates = visibleCleanup.filter((item) => item.source === source).length
          acc[source] = Math.max(agent?.sessionCount ?? 0, sourceCandidates, 1)
          return acc
        },
        {} as Record<AgentSource, number>,
      ),
    [agents, visibleCleanup],
  )

  const sourceProgress = useMemo<CleanupSourceProgress[]>(
    () =>
      agentSources.map((source) => {
        const weight = cleanupSourceWeights[source]
        const total = sourceTotals[source]
        const localProgress = Math.min(
          1,
          Math.max(0, (progress - weight.start) / (weight.end - weight.start)),
        )
        const scanned = Math.min(total, Math.floor(total * localProgress))
        const status =
          progress >= weight.end ? 'Complete' : progress > weight.start ? 'Scanning' : 'Waiting'
        return { source, scanned, total, status }
      }),
    [progress, sourceTotals],
  )

  const categories = useMemo<CleanupCategorySummary[]>(() => {
    const seed: Record<CleanupCategoryKey, CleanupCategorySummary> = {
      large: {
        key: 'large',
        title: 'Large chats',
        description: 'Sessions with unusually large context or logs',
        bytes: 0,
        count: 0,
        action: 'Recommended',
        icon: MessageSquare,
        accent: 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/24',
      },
      inactive: {
        key: 'inactive',
        title: '90 days inactive',
        description: 'Sessions not opened in over 90 days',
        bytes: 0,
        count: 0,
        action: 'Review',
        icon: CalendarDays,
        accent: 'text-blue-300 bg-blue-400/13 ring-blue-400/24',
      },
      test: {
        key: 'test',
        title: 'Test chats',
        description: 'Short 1-2 message sessions and throwaway prompts',
        bytes: 0,
        count: 0,
        action: 'Safe',
        icon: FlaskConical,
        accent: 'text-violet-300 bg-violet-400/13 ring-violet-400/24',
      },
    }

    for (const candidate of visibleCleanup) {
      const category = cleanupCategoryForCandidate(candidate)
      seed[category].bytes += candidate.sizeBytes
      seed[category].count += 1
    }

    return [seed.large, seed.inactive, seed.test]
  }, [visibleCleanup])

  const totalBytes = useMemo(
    () => visibleCleanup.reduce((total, item) => total + item.sizeBytes, 0),
    [visibleCleanup],
  )

  const filteredCleanup = useMemo(() => {
    const result = visibleCleanup.filter((candidate) => {
      if (filter === 'all') return true
      if (filter === 'recoverable') return candidate.recoverable
      return candidate.risk === filter
    })

    return [...result].sort((a, b) => {
      if (sort === 'risk') return cleanupRiskRank[b.risk] - cleanupRiskRank[a.risk]
      if (sort === 'agent') {
        return agentLabel[a.source ?? 'codex'].localeCompare(agentLabel[b.source ?? 'codex'])
      }
      return b.sizeBytes - a.sizeBytes
    })
  }, [filter, sort, visibleCleanup])

  const selectedBytes = useMemo(
    () =>
      visibleCleanup
        .filter((item) => selected.includes(item.id))
        .reduce((total, item) => total + item.sizeBytes, 0),
    [selected, visibleCleanup],
  )
  const selectedItems = useMemo(
    () => visibleCleanup.filter((item) => selected.includes(item.id)),
    [selected, visibleCleanup],
  )
  const selectedAllVisible =
    filteredCleanup.length > 0 && filteredCleanup.every((item) => selected.includes(item.id))
  const firstSelected = selectedItems[0]

  const beginScan = async () => {
    if (stage === 'scanning') return

    const runId = scanRunRef.current + 1
    scanRunRef.current = runId
    setStage('scanning')
    setOrbPhase('scalein')
    setProgress(0)
    setLocalCleanup(null)
    setCleaned(false)
    setCleaningIds([])
    setSelected([])
    clearCleanupViewState()

    window.setTimeout(() => {
      if (scanRunRef.current === runId) setOrbPhase('running')
    }, 360)

    const startedAt = Date.now()
    const minimumVisualScanMs = 1400
    let scanResult: CleanupCandidate[] | undefined
    let scanError: unknown
    let scanSettled = false
    const scanPromise = onScanCleanup()
      .then((items) => {
        scanResult = items
      })
      .catch((error: unknown) => {
        scanError = error
      })
      .finally(() => {
        scanSettled = true
      })

    await new Promise<void>((resolve) => {
      const timer = window.setInterval(() => {
        if (scanRunRef.current !== runId) {
          window.clearInterval(timer)
          resolve()
          return
        }

        const elapsed = Date.now() - startedAt
        const targetProgress = Math.min(94, Math.floor((elapsed / minimumVisualScanMs) * 94))
        setProgress((current) => {
          return Math.max(current, targetProgress)
        })

        if (elapsed >= minimumVisualScanMs && scanSettled) {
          void scanPromise.then(() => {
            window.clearInterval(timer)
            resolve()
          })
        }
      }, 120)
    })

    if (scanRunRef.current !== runId) return

    if (scanError) {
      console.error(scanError)
      setStage('idle')
      setOrbPhase('initial')
      setProgress(0)
      clearCleanupViewState()
      return
    }

    setLocalCleanup(scanResult ?? [])
    setSelected(defaultCleanupSelection(scanResult ?? []))
    setProgress(100)
    setOrbPhase('scaleout')
    window.setTimeout(() => {
      if (scanRunRef.current !== runId) return
      setStage('complete')
      setOrbPhase('finish')
      writeCleanupViewState(scanResult ?? [])
    }, 360)
  }

  const cancelScan = () => {
    scanRunRef.current += 1
    setStage('idle')
    setOrbPhase('initial')
    setProgress(0)
    clearCleanupViewState()
  }

  const resetCleanupStart = () => {
    scanRunRef.current += 1
    setStage('idle')
    setOrbPhase('initial')
    setProgress(0)
    setLocalCleanup(null)
    setSelected([])
    setCleaningIds([])
    setCleaning(false)
    setCleaned(false)
    clearCleanupViewState()
  }

  const showCleanupSummary = () => {
    setStage('complete')
    setOrbPhase('finish')
    writeCleanupViewState(visibleCleanup)
  }

  const toggleSelected = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const toggleCategorySelected = (category: CleanupCategoryKey) => {
    const categoryIds = visibleCleanup
      .filter((candidate) => cleanupCategoryForCandidate(candidate) === category)
      .map((candidate) => candidate.id)
    if (categoryIds.length === 0) return

    setSelected((current) => {
      const selectedInCategory = categoryIds.every((id) => current.includes(id))
      if (selectedInCategory) return current.filter((id) => !categoryIds.includes(id))
      return Array.from(new Set([...current, ...categoryIds]))
    })
  }

  const toggleCandidateSetSelected = (ids: string[]) => {
    if (ids.length === 0) return

    setSelected((current) => {
      const allSelected = ids.every((id) => current.includes(id))
      if (allSelected) return current.filter((id) => !ids.includes(id))
      return Array.from(new Set([...current, ...ids]))
    })
  }

  const toggleVisibleSelected = () => {
    const visibleIds = filteredCleanup.map((item) => item.id)
    setSelected((current) => {
      if (selectedAllVisible) return current.filter((id) => !visibleIds.includes(id))
      return Array.from(new Set([...current, ...visibleIds]))
    })
  }

  const moveSelectedToTrash = async () => {
    if (selected.length === 0 || cleaning) return
    setCleaning(true)
    setCleaned(false)
    setCleaningIds(selected)
    const removing = selected
    try {
      await onMoveToTrash(removing)
      window.setTimeout(() => {
        setLocalCleanup((current) => {
          const next = (current ?? cleanup).filter((item) => !removing.includes(item.id))
          if (stage === 'complete' || stage === 'review') writeCleanupViewState(next)
          return next
        })
        setSelected([])
        setCleaningIds([])
        setCleaning(false)
        setCleaned(true)
        window.setTimeout(() => setCleaned(false), 1500)
      }, 520)
    } catch (error) {
      console.error(error)
      setCleaningIds([])
      setCleaning(false)
    }
  }

  const reviewPanel = (
    <div className="cleanup-review-grid grid h-full min-h-0 grid-cols-[minmax(0,1fr)_332px] gap-5 max-[1180px]:grid-cols-1">
      <Card className="glass-panel flex min-h-0 overflow-hidden rounded-lg py-0">
        <CardHeader className="flex-row items-center justify-between gap-4 px-7 pb-0 pt-6">
          <div className="min-w-0">
            <CardTitle className="text-[20px] font-semibold text-white">
              Cleanup candidates
            </CardTitle>
            <p className="mt-2 text-sm text-white/52">
              Review local sessions before moving anything to app Trash.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={toggleVisibleSelected}
              className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-[13px] font-normal text-white/76 hover:bg-white/10"
            >
              <CheckCircle2 className="size-4" />
              {selectedAllVisible ? 'Deselect visible' : 'Select visible'}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={resetCleanupStart}
              className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-[13px] font-normal text-white/76 hover:bg-white/10"
            >
              <RefreshCcw className="size-4" />
              Scan again
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.035] p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {(
                [
                  ['all', 'All'],
                  ['high', 'High'],
                  ['medium', 'Medium'],
                  ['low', 'Low'],
                  ['recoverable', 'Recoverable'],
                ] satisfies Array<[CleanupFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`h-8 rounded-md px-3 text-xs transition ${
                    filter === value
                      ? 'bg-emerald-400/16 text-emerald-200 ring-1 ring-emerald-300/24'
                      : 'text-white/52 hover:bg-white/8 hover:text-white/78'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-white/44">
              <ListFilter className="size-4" />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as CleanupSort)}
                className="h-8 rounded-md border border-white/10 bg-black/18 px-2 text-xs text-white/76 outline-none"
              >
                <option value="size">Sort: Size</option>
                <option value="risk">Sort: Risk</option>
                <option value="agent">Sort: Agent</option>
              </select>
            </label>
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            {filteredCleanup.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center rounded-lg border border-white/8 bg-white/[0.03] text-center">
                <div>
                  <CheckCircle2 className="mx-auto size-10 text-emerald-300" />
                  <div className="mt-3 text-sm font-medium text-white">No candidates here</div>
                  <div className="mt-1 text-xs text-white/42">
                    Try another filter or scan again.
                  </div>
                </div>
              </div>
            ) : (
              filteredCleanup.map((candidate, index) => (
                <CleanupCandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  checked={selected.includes(candidate.id)}
                  cleaning={cleaningIds.includes(candidate.id)}
                  index={index}
                  onToggle={() => toggleSelected(candidate.id)}
                />
              ))
            )}
          </div>

          <div className="mt-5 flex shrink-0 items-center justify-between border-t border-white/8 px-1 pt-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-emerald-300" />
              <div>
                <div className="text-sm font-medium text-white">
                  {selected.length} candidate{selected.length === 1 ? '' : 's'} selected
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {formatBytes(selectedBytes)} recoverable after backup and Trash move.
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="lg"
              onClick={showCleanupSummary}
              className="h-9 rounded-lg border-white/12 bg-white/5 px-4 text-[13px] font-normal text-white/72 hover:bg-white/10 hover:text-white"
            >
              Summary
            </Button>
          </div>
        </CardContent>
      </Card>

      <CleanupQueuePanel
        selectedItems={selectedItems}
        selectedBytes={selectedBytes}
        firstSelected={firstSelected}
        cleaning={cleaning}
        cleaned={cleaned}
        onMoveToTrash={() => void moveSelectedToTrash()}
        onClear={() => setSelected([])}
      />
    </div>
  )

  return (
    <CleanupScanShell
      stage={stage}
      orbPhase={orbPhase}
      progress={progress}
      sourceProgress={sourceProgress}
      totalBytes={totalBytes}
      categories={categories}
      candidates={visibleCleanup}
      sessionById={sessionById}
      selected={selected}
      cleaning={cleaning}
      cleaningIds={cleaningIds}
      onStart={() => void beginScan()}
      onCancel={cancelScan}
      onScanAgain={resetCleanupStart}
      onClean={() => void moveSelectedToTrash()}
      onToggleCandidate={toggleSelected}
      onToggleCandidates={toggleCandidateSetSelected}
      onToggleCategory={toggleCategorySelected}
      reviewPanel={reviewPanel}
    />
  )
}

function CleanupScanShell({
  stage,
  orbPhase,
  progress,
  sourceProgress,
  totalBytes,
  categories,
  candidates,
  sessionById,
  selected,
  cleaning,
  cleaningIds,
  onStart,
  onCancel,
  onScanAgain,
  onClean,
  onToggleCandidate,
  onToggleCandidates,
  onToggleCategory,
  reviewPanel,
}: {
  stage: CleanupStage
  orbPhase: CleanupOrbPhase
  progress: number
  sourceProgress: CleanupSourceProgress[]
  totalBytes: number
  categories: CleanupCategorySummary[]
  candidates: CleanupCandidate[]
  sessionById: Map<string, SessionRecord>
  selected: string[]
  cleaning: boolean
  cleaningIds: string[]
  onStart: () => void
  onCancel: () => void
  onScanAgain: () => void
  onClean: () => void
  onToggleCandidate: (id: string) => void
  onToggleCandidates: (ids: string[]) => void
  onToggleCategory: (category: CleanupCategoryKey) => void
  reviewPanel: ReactNode
}) {
  const orbMode: CleanupScanStage = stage === 'review' ? 'complete' : stage
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState(initialCleanupStageSize)

  useEffect(() => {
    const node = stageRef.current
    if (!node) return

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      setStageSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      })
    }

    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  const orbSize = clampNumber(stageSize.height * 0.42, cleanupOrbMinSize, cleanupOrbMaxSize)
  const idleTop = clampNumber(
    stageSize.height * 0.5 - orbSize / 2 - 54,
    48,
    Math.max(48, stageSize.height - orbSize - 124),
  )
  const completeOrbSize = clampNumber(stageSize.height * 0.31, 224, cleanupOrbMaxSize)
  const activeOrbSize = stage === 'complete' ? completeOrbSize : orbSize
  const orbTop = stage === 'idle' ? idleTop : stage === 'complete' ? 42 : 118
  const orbLeft =
    stage === 'complete'
      ? clampNumber(stageSize.width - activeOrbSize - 64, 420, stageSize.width - activeOrbSize - 28)
      : stage === 'scanning'
        ? clampNumber(
            stageSize.width * 0.72 - activeOrbSize / 2,
            620,
            stageSize.width - activeOrbSize - 64,
          )
        : stageSize.width / 2 - activeOrbSize / 2
  const orbProps =
    orbMode === 'idle'
      ? {
          mode: 'idle' as const,
          phase: orbPhase,
          progress: 0,
          icon: <Search className="size-16" />,
          title: 'Start Scan',
          onClick: onStart,
        }
      : orbMode === 'scanning'
        ? {
            mode: 'scanning' as const,
            phase: orbPhase,
            progress,
            title: 'Scanning...',
          }
        : {
            mode: 'complete' as const,
            phase: orbPhase,
            progress: 100,
            icon: <CheckCircle2 className="size-12" />,
            title: formatBytes(totalBytes),
            detail: totalBytes > 0 ? 'Ready to clean' : 'Nothing to clean',
          }

  return (
    <div ref={stageRef} className={`cleanup-stage cleanup-stage-${stage}`}>
      <motion.div
        className={`cleanup-orb-layer cleanup-orb-layer-${stage}`}
        initial={false}
        animate={{
          x: orbLeft,
          y: orbTop,
          width: activeOrbSize,
          height: activeOrbSize,
          opacity: stage === 'review' ? 0 : 1,
        }}
        transition={cleanupOrbMorphTransition}
      >
        <CleanupOrbButton {...orbProps} size={activeOrbSize} />
      </motion.div>
      <div className="cleanup-view-layer cleanup-idle-layer">
        <AnimatePresence>
          {stage === 'idle' && (
            <motion.div
              key="idle"
              className="cleanup-stage-body cleanup-stage-body-idle"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              <CleanupIdleBody />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cleanup-view-layer cleanup-scanning-layer">
        <AnimatePresence>
          {stage === 'scanning' && (
            <motion.div
              key="scanning"
              className="cleanup-stage-body cleanup-stage-body-scanning"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              <CleanupScanningBody
                progress={progress}
                sourceProgress={sourceProgress}
                onCancel={onCancel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cleanup-view-layer cleanup-complete-layer">
        <AnimatePresence>
          {stage === 'complete' && (
            <motion.div
              key="complete"
              className="cleanup-stage-body cleanup-stage-body-complete h-full min-h-0"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              <CleanupCompleteBody
                categories={categories}
                candidates={candidates}
                sessionById={sessionById}
                selected={selected}
                cleaning={cleaning}
                cleaningIds={cleaningIds}
                onClean={onClean}
                onScanAgain={onScanAgain}
                onToggleCandidate={onToggleCandidate}
                onToggleCandidates={onToggleCandidates}
                onToggleCategory={onToggleCategory}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cleanup-view-layer cleanup-review-layer">
        <AnimatePresence>
          {stage === 'review' && (
            <motion.div
              key="review"
              className="cleanup-stage-body cleanup-stage-body-review h-full min-h-0"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              {reviewPanel}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <CleanupSafetyNote
        className="cleanup-safety-bottom"
        text={
          stage === 'complete' || stage === 'review'
            ? 'All session data was analyzed locally.'
            : 'All session data is analyzed locally.'
        }
      />
    </div>
  )
}

function CleanupIdleBody() {
  return (
    <>
      <div className="text-center text-[14px] text-white/58">
        Scan large chats, inactive chats, and test chats.
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2 [@media(max-height:760px)]:mt-3">
        <CleanupPill icon={<MessageSquare className="size-4" />} label="Large chats" />
        <CleanupPill icon={<Clock className="size-4" />} label="90 days inactive" />
        <CleanupPill icon={<FlaskConical className="size-4" />} label="Test chats" />
      </div>
    </>
  )
}

function CleanupScanningBody({
  progress,
  sourceProgress,
  onCancel,
}: {
  progress: number
  sourceProgress: CleanupSourceProgress[]
  onCancel: () => void
}) {
  return (
    <>
      <div className="text-center text-[14px] text-white/58">
        Analyzing session size, inactivity, and test chats
      </div>
      <Card className="cleanup-scan-card mt-3.5 w-full max-w-[600px] rounded-lg py-0 [@media(max-height:760px)]:mt-3">
        <CardContent className="px-3.5 py-3">
          <div className="space-y-2.5">
            {sourceProgress.map((item) => (
              <CleanupSourceRow key={item.source} item={item} />
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="mt-3.5 flex items-center justify-center [@media(max-height:760px)]:mt-3">
        <Button
          variant="outline"
          size="lg"
          onClick={onCancel}
          className="cleanup-action-button h-9 rounded-lg border-white/14 bg-white/5 px-5 text-[13px] text-white/84 hover:bg-white/10"
        >
          Cancel
        </Button>
      </div>
      <p className="mt-2.5 text-center text-xs text-white/36">
        Scanning local sources. {Math.round(progress)}% complete.
      </p>
    </>
  )
}

function CleanupCompleteBody({
  categories,
  candidates,
  sessionById,
  selected,
  cleaning,
  cleaningIds,
  onClean,
  onScanAgain,
  onToggleCandidate,
  onToggleCandidates,
  onToggleCategory,
}: {
  categories: CleanupCategorySummary[]
  candidates: CleanupCandidate[]
  sessionById: Map<string, SessionRecord>
  selected: string[]
  cleaning: boolean
  cleaningIds: string[]
  onClean: () => void
  onScanAgain: () => void
  onToggleCandidate: (id: string) => void
  onToggleCandidates: (ids: string[]) => void
  onToggleCategory: (category: CleanupCategoryKey) => void
}) {
  const [expandedCategory, setExpandedCategory] = useState<CleanupCategoryKey | null>('inactive')
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const candidatesByCategory = useMemo(() => {
    const grouped: Record<CleanupCategoryKey, CleanupCandidate[]> = {
      large: [],
      inactive: [],
      test: [],
    }

    for (const candidate of candidates) {
      grouped[cleanupCategoryForCandidate(candidate)].push(candidate)
    }

    return grouped
  }, [candidates])
  const groupsByCategory = useMemo(
    () => ({
      large: buildCleanupCandidateGroups(candidatesByCategory.large, sessionById),
      inactive: buildCleanupCandidateGroups(candidatesByCategory.inactive, sessionById),
      test: buildCleanupCandidateGroups(candidatesByCategory.test, sessionById),
    }),
    [candidatesByCategory, sessionById],
  )
  const selectedCount = candidates.filter((candidate) => selected.includes(candidate.id)).length
  const selectedBytes = candidates
    .filter((candidate) => selected.includes(candidate.id))
    .reduce((total, candidate) => total + candidate.sizeBytes, 0)

  return (
    <div className="cleanup-complete-layout">
      <div className="cleanup-complete-list">
        <div className="cleanup-complete-description text-[14px] text-white/58">
          Large chats, inactive chats, and test chats were found locally.
        </div>
        <div className="cleanup-result-accordion mt-4">
          {categories.map((category) => (
            <CleanupCategoryRow
              key={category.key}
              category={category}
              candidates={candidatesByCategory[category.key]}
              groups={groupsByCategory[category.key]}
              expanded={expandedCategory === category.key}
              expandedGroupId={expandedGroupId}
              selected={selected}
              cleaningIds={cleaningIds}
              onToggleExpanded={() => {
                setExpandedCategory((current) => (current === category.key ? null : category.key))
                setExpandedGroupId(null)
              }}
              onToggleCategory={() => onToggleCategory(category.key)}
              onToggleCandidate={onToggleCandidate}
              onToggleCandidates={onToggleCandidates}
              onToggleGroup={(groupId) =>
                setExpandedGroupId((current) => (current === groupId ? null : groupId))
              }
            />
          ))}
        </div>
      </div>
      <div className="cleanup-result-actions">
        <div className="cleanup-result-selection">
          <ShieldCheck className="size-4 text-emerald-300" />
          <span>
            {selectedCount} selected / {formatBytes(selectedBytes)}
          </span>
        </div>
        <Button
          onClick={onClean}
          disabled={selectedCount === 0 || cleaning}
          className="cleanup-primary-action h-10 min-w-[176px] rounded-lg bg-emerald-400 text-[13px] font-semibold text-emerald-950 shadow-[0_18px_38px_rgb(52_211_153_/_26%)] hover:bg-emerald-300 disabled:pointer-events-none disabled:brightness-75 disabled:saturate-50"
        >
          <Sparkles className="size-4" />
          Clean
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={onScanAgain}
          className="cleanup-action-button h-10 min-w-[156px] rounded-lg border-white/14 bg-white/5 text-[13px] text-white/84 hover:bg-white/10"
        >
          <RefreshCcw className="size-4" />
          Scan Again
        </Button>
      </div>
    </div>
  )
}

function CleanupOrbButton({
  mode,
  phase,
  progress,
  size,
  icon,
  title,
  detail,
  onClick,
}: {
  mode: 'idle' | 'scanning' | 'complete'
  phase: CleanupOrbPhase
  progress: number
  size: number
  icon?: ReactNode
  title: string
  detail?: string
  onClick?: () => void
}) {
  const visualScale = mode === 'scanning' ? cleanupScanningOrbScale : 1
  const textScale = size / cleanupOrbMaxSize
  const stroke = mode === 'scanning' ? 10 : 7
  const radius = size / 2 - stroke * 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (progress / 100) * circumference
  const displayParts = title.split(' ')

  const content =
    mode === 'scanning' ? (
      <>
        <span className="cleanup-orb-percent">{Math.round(progress)}</span>
        <span className="cleanup-orb-status">{title}</span>
      </>
    ) : mode === 'complete' ? (
      <>
        <span className="cleanup-orb-check">{icon}</span>
        <span className="cleanup-orb-size">
          <span>{displayParts[0]}</span>
          <small>{displayParts.slice(1).join(' ')}</small>
        </span>
        {detail && <span className="cleanup-orb-ready">{detail}</span>}
      </>
    ) : (
      <>
        <span className="cleanup-orb-icon">{icon}</span>
        <span className="cleanup-orb-label">{title}</span>
      </>
    )

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`cleanup-orb cleanup-orb-${mode}`}
      aria-label={onClick ? title : undefined}
      initial={false}
      animate={{
        width: size,
        height: size,
        opacity: 1,
      }}
      whileHover={onClick ? { scale: 1.012 } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      transition={cleanupOrbMorphTransition}
      data-phase={phase}
      style={{ '--cleanup-orb-scale': textScale } as CSSProperties}
    >
      <motion.span
        className={`cleanup-orb-visual cleanup-orb-visual-${mode}`}
        initial={false}
        animate={{ scale: visualScale }}
        transition={cleanupOrbMorphTransition}
        data-phase={phase}
      >
        <span className="cleanup-orb-particles" />
        <svg
          className="cleanup-orb-ring"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            className="cleanup-orb-track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
          />
          <circle
            className="cleanup-orb-progress"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={mode === 'idle' ? 0 : dashOffset}
          />
        </svg>
        <motion.span
          key={mode}
          className={`cleanup-orb-content cleanup-orb-content-${mode}`}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {content}
        </motion.span>
      </motion.span>
    </motion.button>
  )
}

function CleanupPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-9 min-w-[136px] items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3.5 text-[12px] text-white/72 shadow-[inset_0_1px_0_rgb(255_255_255_/_6%)]">
      <span className="text-emerald-300">{icon}</span>
      {label}
    </div>
  )
}

function CleanupSafetyNote({ className, text }: { className?: string; text: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-3 text-sm text-white/43 ${className ?? ''}`}
    >
      <ShieldCheck className="size-4 text-white/38" />
      {text}
    </div>
  )
}

function CleanupSourceRow({ item }: { item: CleanupSourceProgress }) {
  const percent =
    item.total === 0 ? 0 : Math.min(100, Math.round((item.scanned / item.total) * 100))
  const StatusIcon =
    item.status === 'Complete' ? CheckCircle2 : item.status === 'Scanning' ? Loader2 : Clock

  return (
    <div className="cleanup-source-row grid grid-cols-[132px_minmax(0,1fr)_64px_80px] items-center gap-2.5 max-[980px]:grid-cols-[124px_minmax(0,1fr)_58px_76px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentGlyph source={item.source} />
        <span className="truncate text-[13px] font-medium text-white/82">
          {agentLabel[item.source]}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-emerald-300 transition-[width] duration-500 ease-out shadow-[0_0_14px_rgb(52_211_153_/_55%)]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="text-right text-xs tabular-nums text-white/58">
        {item.scanned} / {item.total}
      </div>
      <div className="flex items-center gap-2 text-xs text-white/50">
        <StatusIcon
          className={`size-4 ${
            item.status === 'Complete'
              ? 'text-emerald-300'
              : item.status === 'Scanning'
                ? 'animate-spin text-emerald-300'
                : 'text-white/38'
          }`}
        />
        {item.status}
      </div>
    </div>
  )
}

function CleanupCategoryRow({
  category,
  candidates,
  groups,
  expanded,
  expandedGroupId,
  selected,
  cleaningIds,
  onToggleExpanded,
  onToggleCategory,
  onToggleCandidate,
  onToggleCandidates,
  onToggleGroup,
}: {
  category: CleanupCategorySummary
  candidates: CleanupCandidate[]
  groups: CleanupCandidateGroup[]
  expanded: boolean
  expandedGroupId: string | null
  selected: string[]
  cleaningIds: string[]
  onToggleExpanded: () => void
  onToggleCategory: () => void
  onToggleCandidate: (id: string) => void
  onToggleCandidates: (ids: string[]) => void
  onToggleGroup: (groupId: string) => void
}) {
  const Icon = category.icon
  const ActionIcon =
    category.action === 'Recommended' ? Sparkles : category.action === 'Review' ? Eye : ShieldCheck
  const selectedInCategory = candidates.filter((candidate) => selected.includes(candidate.id))
  const allSelected = candidates.length > 0 && selectedInCategory.length === candidates.length
  const someSelected = selectedInCategory.length > 0 && !allSelected
  const accentClass =
    category.key === 'large'
      ? 'cleanup-category-accent-green'
      : category.key === 'inactive'
        ? 'cleanup-category-accent-blue'
        : 'cleanup-category-accent-violet'
  const tagClass =
    category.action === 'Recommended'
      ? 'cleanup-category-tag-green'
      : category.action === 'Review'
        ? 'cleanup-category-tag-blue'
        : 'cleanup-category-tag-neutral'

  return (
    <div className={`cleanup-category-row ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        onClick={onToggleExpanded}
        className="cleanup-category-trigger"
        aria-expanded={expanded}
      >
        <span className={`cleanup-category-icon ${accentClass}`}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-white">
            {category.title}
            <span className="cleanup-category-count">{category.count}</span>
          </span>
          <span className="mt-1 block truncate text-[12px] text-white/52">
            {category.description}
          </span>
        </span>
        <Badge variant="outline" className={`cleanup-category-tag ${tagClass}`}>
          <ActionIcon className="size-3.5" />
          {category.action}
        </Badge>
        <span className="text-right text-[14px] font-semibold text-white">
          {formatBytes(category.bytes)}
        </span>
        <ChevronDown
          className={`cleanup-category-chevron size-4 text-white/64 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="cleanup-category-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="cleanup-group-list">
              <div className="cleanup-group-header">
                <button
                  type="button"
                  onClick={onToggleCategory}
                  className={`cleanup-check ${allSelected ? 'is-checked' : ''} ${
                    someSelected ? 'is-mixed' : ''
                  }`}
                  aria-label={`${allSelected ? 'Deselect' : 'Select'} ${category.title}`}
                >
                  {allSelected ? <Check className="size-3.5" /> : someSelected ? '–' : null}
                </button>
                <span>Group</span>
                <span>Agent</span>
                <span>Sessions</span>
                <span>Last opened</span>
                <span>Size</span>
                <span />
              </div>

              {groups.map((group) => (
                <CleanupCandidateGroupRow
                  key={group.id}
                  group={group}
                  expanded={expandedGroupId === group.id}
                  selected={selected}
                  cleaningIds={cleaningIds}
                  onToggleGroup={() => onToggleGroup(group.id)}
                  onToggleGroupSelected={() =>
                    onToggleCandidates(group.candidates.map((candidate) => candidate.id))
                  }
                  onToggleCandidate={onToggleCandidate}
                />
              ))}

              {groups.length === 0 && (
                <div className="cleanup-session-empty">No sessions in this category.</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CleanupCandidateGroupRow({
  group,
  expanded,
  selected,
  cleaningIds,
  onToggleGroup,
  onToggleGroupSelected,
  onToggleCandidate,
}: {
  group: CleanupCandidateGroup
  expanded: boolean
  selected: string[]
  cleaningIds: string[]
  onToggleGroup: () => void
  onToggleGroupSelected: () => void
  onToggleCandidate: (id: string) => void
}) {
  const selectedInGroup = group.candidates.filter((candidate) => selected.includes(candidate.id))
  const allSelected =
    group.candidates.length > 0 && selectedInGroup.length === group.candidates.length
  const someSelected = selectedInGroup.length > 0 && !allSelected
  const visibleCandidates = group.candidates.slice(0, cleanupMaxVisibleGroupSessions)
  const hiddenCandidateCount = Math.max(0, group.candidates.length - visibleCandidates.length)

  return (
    <div className={`cleanup-group-row ${expanded ? 'is-expanded' : ''}`}>
      <div className="cleanup-group-trigger">
        <button
          type="button"
          onClick={onToggleGroupSelected}
          className={`cleanup-check ${allSelected ? 'is-checked' : ''} ${
            someSelected ? 'is-mixed' : ''
          }`}
          aria-label={`${allSelected ? 'Deselect' : 'Select'} ${group.workspace.label}`}
        >
          {allSelected ? <Check className="size-3.5" /> : someSelected ? '–' : null}
        </button>
        <button
          type="button"
          onClick={onToggleGroup}
          className="cleanup-group-main"
          aria-expanded={expanded}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-white/90">
              {group.workspace.label}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-white/42">
              {cleanupCompactPath(group.workspace.detail)}
            </span>
          </span>
          <span className={`cleanup-source-pill cleanup-source-pill-${group.source}`}>
            {agentLabel[group.source]}
          </span>
          <span className="text-white/58">{group.candidates.length}</span>
          <span className="text-white/52">
            {group.latestOpened ? formatRelative(group.latestOpened) : 'Unknown'}
          </span>
          <span className="text-right font-medium text-white/72">{formatBytes(group.bytes)}</span>
          <ChevronDown
            className={`cleanup-category-chevron size-4 justify-self-end text-white/58 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="cleanup-group-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="cleanup-session-table">
              <div className="cleanup-session-header">
                <span />
                <span>Session</span>
                <span>Source</span>
                <span>Last opened</span>
                <span>Size</span>
                <span>Safety</span>
                <span />
              </div>
              {visibleCandidates.map((candidate) => (
                <CleanupResultSessionRow
                  key={candidate.id}
                  candidate={candidate}
                  checked={selected.includes(candidate.id)}
                  cleaning={cleaningIds.includes(candidate.id)}
                  onToggle={() => onToggleCandidate(candidate.id)}
                />
              ))}
              {hiddenCandidateCount > 0 && (
                <div className="cleanup-session-more">
                  {hiddenCandidateCount} more sessions in this group. Use the group checkbox to
                  select or clear all.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CleanupResultSessionRow({
  candidate,
  checked,
  cleaning,
  onToggle,
}: {
  candidate: CleanupCandidate
  checked: boolean
  cleaning: boolean
  onToggle: () => void
}) {
  const source = candidate.source ?? 'codex'
  const sessionId = candidate.sessionIds[0] ?? candidate.id

  return (
    <div className={`cleanup-session-row ${cleaning ? 'is-cleaning' : ''}`}>
      {cleaning && <div className="cleanup-cleaning-bar" />}
      <button
        type="button"
        onClick={onToggle}
        disabled={cleaning}
        className={`cleanup-check ${checked ? 'is-checked' : ''}`}
        aria-label={`${checked ? 'Deselect' : 'Select'} ${candidate.title}`}
      >
        {checked && <Check className="size-3.5" />}
      </button>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-white/90">{candidate.title}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/42">Session ID: {sessionId}</div>
      </div>
      <span className={`cleanup-source-pill cleanup-source-pill-${source}`}>
        {agentLabel[source]}
      </span>
      <span className="text-white/56">
        {candidate.lastUpdated ? formatRelative(candidate.lastUpdated) : 'Unknown'}
      </span>
      <span className="font-medium text-white/70">{formatBytes(candidate.sizeBytes)}</span>
      <Badge
        variant="outline"
        className="cleanup-safety-pill h-6 justify-center rounded-full px-2.5 text-[11px] ring-1"
      >
        <ShieldCheck className="size-3.5" />
        Safe
      </Badge>
      <button
        type="button"
        className="cleanup-more-button"
        aria-label={`More actions for ${candidate.title}`}
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  )
}
function CleanupCandidateRow({
  candidate,
  checked,
  cleaning,
  index,
  onToggle,
}: {
  candidate: CleanupCandidate
  checked: boolean
  cleaning: boolean
  index: number
  onToggle: () => void
}) {
  const meta = cleanupKindMeta[candidate.kind]
  const Icon = meta.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`cleanup-candidate-row group relative grid min-h-[116px] grid-cols-[30px_52px_minmax(0,1fr)_104px] items-center gap-4 overflow-hidden rounded-lg border px-4 py-4 transition max-[1280px]:grid-cols-[28px_48px_minmax(0,1fr)] ${
            checked
              ? 'border-emerald-300/20 bg-emerald-400/[0.055]'
              : 'border-white/9 bg-white/[0.03] hover:bg-white/[0.055]'
          } ${candidate.risk === 'high' ? 'cleanup-high-risk' : ''} ${cleaning ? 'cleanup-row-removing' : ''}`}
          style={{ animationDelay: `${Math.min(index * 70, 420)}ms` }}
        >
          {cleaning && <div className="cleanup-cleaning-bar" />}
          <button
            type="button"
            onClick={onToggle}
            disabled={cleaning}
            aria-label={`${checked ? 'Deselect' : 'Select'} ${candidate.title}`}
            className={`grid size-6 place-items-center rounded-md border transition ${
              checked
                ? 'border-emerald-300/42 bg-emerald-400/16 text-emerald-200'
                : 'border-white/16 bg-black/12 text-transparent group-hover:text-white/45'
            }`}
          >
            <CheckCircle2 className="size-4" />
          </button>
          <div
            className={`grid size-[52px] place-items-center rounded-lg ring-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_10%)] ${meta.accent}`}
          >
            <Icon className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 truncate text-[16px] font-semibold text-white">
                {candidate.title}
              </div>
              <Badge
                variant="outline"
                className={`h-6 rounded-full px-2.5 text-[11px] capitalize ring-1 ${riskAccent[candidate.risk]}`}
              >
                {candidate.risk}
              </Badge>
              <Badge className="h-6 rounded-full bg-white/6 px-2.5 text-[11px] text-white/58 ring-1 ring-white/10">
                {meta.label}
              </Badge>
              {candidate.recoverable && (
                <Badge className="h-6 rounded-full bg-emerald-400/10 px-2.5 text-[11px] text-emerald-300 ring-1 ring-emerald-400/20">
                  recoverable
                </Badge>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-white/52">
              {candidate.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/36">
              <span>
                {candidate.paths.length} path{candidate.paths.length === 1 ? '' : 's'}
              </span>
              {candidate.source && (
                <>
                  <span>/</span>
                  <span>{agentLabel[candidate.source]}</span>
                </>
              )}
              {candidate.lastUpdated && (
                <>
                  <span>/</span>
                  <span>{formatRelative(candidate.lastUpdated)}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right max-[1280px]:col-start-3 max-[1280px]:text-left">
            <div className="text-[19px] font-semibold text-white">
              {formatBytes(candidate.sizeBytes)}
            </div>
            <div className="mt-1 text-[11px] uppercase text-white/38">
              {candidate.backedUp ? 'backed up' : 'backup first'}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="chart-tooltip block max-w-[340px] rounded-lg px-3 py-3 text-left text-white">
        <div className="text-xs font-semibold text-white">{candidate.title}</div>
        <div className="mt-1 text-[11px] leading-4 text-white/58">
          {candidate.reason}{' '}
          {candidate.recoverable ? 'This item remains recoverable from app Trash.' : ''}
        </div>
        <div className="mt-2 truncate text-[11px] text-white/38">{candidate.paths[0]}</div>
      </TooltipContent>
    </Tooltip>
  )
}

function CleanupQueuePanel({
  selectedItems,
  selectedBytes,
  firstSelected,
  cleaning,
  cleaned,
  onMoveToTrash,
  onClear,
}: {
  selectedItems: CleanupCandidate[]
  selectedBytes: number
  firstSelected?: CleanupCandidate
  cleaning: boolean
  cleaned: boolean
  onMoveToTrash: () => void
  onClear: () => void
}) {
  const selectedColor = (index: number) =>
    ['bg-emerald-300', 'bg-amber-300', 'bg-blue-300', 'bg-violet-300', 'bg-sky-300'][index % 5]
  const [sizeValue, sizeUnit = ''] = formatBytes(selectedBytes).split(' ')

  return (
    <Card className="glass-panel sticky top-5 h-fit rounded-lg py-0">
      <CardHeader className="flex-row items-center justify-between px-6 pb-0 pt-6">
        <CardTitle className="text-[18px] font-semibold text-white">Clean Queue</CardTitle>
        {cleaned ? (
          <CheckCircle2 className="cleanup-success-pop size-5 text-emerald-300" />
        ) : (
          <Pin className="size-5 text-white/76" />
        )}
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-6">
        <div className="flex items-end gap-2 text-white">
          <span className="text-[42px] font-semibold leading-none">{sizeValue}</span>
          <span className="pb-1 text-[22px] font-semibold">{sizeUnit}</span>
        </div>
        <div className="mt-2 text-sm text-white/52">
          {selectedItems.length} item{selectedItems.length === 1 ? '' : 's'} selected
        </div>

        {firstSelected ? (
          <div className="mt-5 rounded-lg border border-white/8 bg-white/[0.035] p-4">
            <div className="text-xs uppercase text-white/34">Selected detail</div>
            <div className="mt-2 text-sm font-medium text-white">{firstSelected.title}</div>
            <p className="mt-2 text-xs leading-5 text-white/46">{firstSelected.reason}</p>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-white/8 bg-white/[0.03] p-4 text-sm text-white/46">
            Select sessions to build a safe cleanup queue.
          </div>
        )}

        <Separator className="my-6 bg-white/10" />
        <div className="space-y-4 text-[13px] text-white/60">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-emerald-300" />
            Backed up before removal
          </div>
          <div className="flex items-center gap-3">
            <Trash2 className="size-4 text-blue-300" />
            Moved to app Trash
          </div>
          <div className="flex items-center gap-3">
            <RefreshCcw className="size-4 text-violet-300" />
            Recoverable while retained
          </div>
        </div>
        <Separator className="my-6 bg-white/10" />
        <div className="max-h-[190px] space-y-3 overflow-auto pr-1">
          {selectedItems.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2 text-[13px]">
              <span className={`size-2.5 rounded-full ${selectedColor(index)}`} />
              <span className="min-w-0 flex-1 truncate text-white/56">
                {cleanupKindMeta[item.kind].label}
              </span>
              <span className="text-white/56">{formatBytes(item.sizeBytes)}</span>
            </div>
          ))}
        </div>
        <Button
          onClick={onMoveToTrash}
          disabled={selectedItems.length === 0 || cleaning}
          className={`cleanup-primary-action mt-6 h-11 w-full rounded-lg text-[15px] font-semibold ${
            cleaning
              ? 'bg-emerald-400/80 text-emerald-950'
              : 'bg-blue-500 text-white shadow-[0_12px_28px_rgb(37_99_235_/_28%)] hover:bg-blue-400'
          }`}
        >
          {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {cleaning ? 'Backing up...' : 'Move to Trash'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={selectedItems.length === 0 || cleaning}
          className="mt-2 h-8 w-full text-xs text-white/42 hover:bg-white/7 hover:text-white/70"
        >
          Clear selection
        </Button>
        {cleaned && (
          <div className="cleanup-success-pop mt-3 text-center text-xs font-medium text-emerald-300">
            Cleanup moved to Trash
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function usageDaysForPageRange(usage: UsagePoint[], range: UsagePageRange): number {
  if (range === 'all') return usage.length || 365
  return Number.parseInt(range, 10)
}

function usagePageRangeLabel(range: UsagePageRange): string {
  return usagePageRanges.find((item) => item.value === range)?.label ?? '7D'
}

function usageForPageRange(usage: UsagePoint[], range: UsagePageRange): UsagePoint[] {
  if (range === 'all') return usage
  return usage.slice(-usageDaysForPageRange(usage, range))
}

function priorUsageForPageRange(usage: UsagePoint[], range: UsagePageRange): UsagePoint[] {
  if (range === 'all') return []
  const days = usageDaysForPageRange(usage, range)
  const end = Math.max(0, usage.length - days)
  return usage.slice(Math.max(0, end - days), end)
}

function formatUsageTokens(tokens: number): string {
  const value = Math.max(0, tokens)
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function formatUsageShare(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24
  if (normalized === 0) return '12 AM'
  if (normalized === 12) return '12 PM'
  return normalized > 12 ? `${normalized - 12} PM` : `${normalized} AM`
}

function formatHourRange(startHour: number, endHour: number): string {
  return `${formatHourLabel(startHour)} - ${formatHourLabel(endHour)}`
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date.slice(5)
  return parsed.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function formatUsageDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: '2-digit',
    day: '2-digit',
  })
}

function usageTotalForPoints(usage: UsagePoint[]): number {
  return usage.reduce((total, point) => total + point.total, 0)
}

function sessionCostTotal(sessions: SessionRecord[]): number {
  return sessions.reduce(
    (total, session) =>
      total +
      (typeof session.tokens.costUsd === 'number' && session.tokens.costUsd > 0
        ? session.tokens.costUsd
        : 0),
    0,
  )
}

function sessionCostTokenTotal(sessions: SessionRecord[]): number {
  return sessions.reduce((total, session) => {
    if (typeof session.tokens.costUsd !== 'number' || session.tokens.costUsd <= 0) return total
    return total + session.tokens.total
  }, 0)
}

function sessionCostTokenTotalForDates(sessions: SessionRecord[], dates: Set<string>): number {
  return sessions.reduce((total, session) => {
    if (typeof session.tokens.costUsd !== 'number' || session.tokens.costUsd <= 0) return total
    return (
      total +
      sessionDateTokenEntries(session).reduce(
        (sum, [date, tokens]) => sum + (dates.has(date) ? tokens : 0),
        0,
      )
    )
  }, 0)
}

function sessionTokenTotal(sessions: SessionRecord[]): number {
  return sessions.reduce((total, session) => total + session.tokens.total, 0)
}

function costForTokenShare(tokens: number, totalTokens: number, totalCost: number): number {
  if (tokens <= 0 || totalTokens <= 0 || totalCost <= 0) return 0
  return (tokens / totalTokens) * totalCost
}

function sessionDateTokenEntries(session: SessionRecord): Array<[string, number]> {
  const usageByDate = session.metadata.usageByDate
  if (usageByDate && typeof usageByDate === 'object' && !Array.isArray(usageByDate)) {
    const entries = Object.entries(usageByDate).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    )
    if (entries.length > 0) return entries
  }

  return [[dateKeyFromTime(new Date(session.lastUpdated).getTime()), session.tokens.total]]
}

function costByDateFromSessions(sessions: SessionRecord[]): Map<string, number> {
  const costs = new Map<string, number>()
  for (const session of sessions) {
    if (typeof session.tokens.costUsd !== 'number' || session.tokens.costUsd <= 0) continue
    const entries = sessionDateTokenEntries(session)
    const total = entries.reduce((sum, [, tokens]) => sum + tokens, 0)
    if (total <= 0) continue

    for (const [date, tokens] of entries) {
      costs.set(
        date,
        (costs.get(date) ?? 0) + costForTokenShare(tokens, total, session.tokens.costUsd),
      )
    }
  }

  return costs
}

function costForDates(costByDate: Map<string, number>, dates: Iterable<string>): number {
  let total = 0
  for (const date of dates) {
    total += costByDate.get(date) ?? 0
  }
  return total
}

function rangeSessionsForUsage(
  sessions: SessionRecord[],
  range: UsagePageRange,
  dateKeys: Set<string>,
): SessionRecord[] {
  if (range === 'all') return sessions
  return sessions.filter((session) =>
    dateKeys.has(dateKeyFromTime(new Date(session.lastUpdated).getTime())),
  )
}

function usageTrendDetail(current: number, previous: number, unit: string): string {
  if (previous <= 0) return current > 0 ? `+100.0% vs prior period` : `No ${unit} yet`
  const delta = ((current - previous) / previous) * 100
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}% vs prior period`
}

function usageSparklineTrend(usage: UsagePoint[], key: AgentSource | 'total' = 'total'): number[] {
  return usage.slice(-12).map((point) => point[key])
}

function createSparklinePath(values: number[], width = 96, height = 32): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width
      const y = height - ((value - min) / range) * (height - 4) - 2
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

function usageTokenMixFromSessions(sessions: SessionRecord[], totalTokens: number): TokenMix {
  const raw = sessions.reduce(
    (acc, session) => {
      acc.input += session.tokens.input
      acc.output += session.tokens.output
      acc.cache += session.tokens.cached
      acc.total += session.tokens.total
      return acc
    },
    { input: 0, output: 0, cache: 0, total: 0 },
  )
  const knownTotal = raw.input + raw.output + raw.cache
  let tools = Math.max(0, raw.total - knownTotal)
  if (tools <= 0 && raw.total > 0) tools = raw.total * usageDefaultMix.tools

  if (knownTotal + tools > 0) {
    const scale = totalTokens > 0 ? totalTokens / (knownTotal + tools) : 1
    return {
      input: raw.input * scale,
      output: raw.output * scale,
      cache: raw.cache * scale,
      tools: tools * scale,
    }
  }

  return {
    input: totalTokens * usageDefaultMix.input,
    output: totalTokens * usageDefaultMix.output,
    cache: totalTokens * usageDefaultMix.cache,
    tools: totalTokens * usageDefaultMix.tools,
  }
}

function buildDailyUsageTrend(usage: UsagePoint[], tokenMix: TokenMix): DailyUsageTrendPoint[] {
  const mixTotal = Math.max(1, tokenMix.input + tokenMix.output + tokenMix.cache + tokenMix.tools)
  return usage.map((point) => ({
    date: point.date,
    input: point.total * (tokenMix.input / mixTotal),
    output: point.total * (tokenMix.output / mixTotal),
    cache: point.total * (tokenMix.cache / mixTotal),
    tools: point.total * (tokenMix.tools / mixTotal),
    total: point.total,
    cost: 0,
  }))
}

function attachDailyCosts(
  trend: DailyUsageTrendPoint[],
  costByDate: Map<string, number>,
): DailyUsageTrendPoint[] {
  return trend.map((point) => ({ ...point, cost: costByDate.get(point.date) ?? 0 }))
}

function usageHourlyWeight(hour: number): number {
  const afternoonPeak = Math.exp(-((hour - 15) ** 2) / 13)
  const morningPeak = Math.exp(-((hour - 10) ** 2) / 20)
  const eveningPeak = Math.exp(-((hour - 20) ** 2) / 18)
  return 0.16 + afternoonPeak * 1.25 + morningPeak * 0.68 + eveningPeak * 0.34
}

const usageHourlyWeights = usageHours.map(usageHourlyWeight)
const usageHourlyWeightTotal = usageHourlyWeights.reduce((total, value) => total + value, 0)

type UsageHeatmapRow = {
  key: string
  label: string
  tooltipLabel: string
  dateKeys: string[]
  total: number
}

function buildUsageHeatmapRows(usage: UsagePoint[], range: UsagePageRange): UsageHeatmapRow[] {
  if (usage.length === 0) return []
  if (range === '7d' || usage.length <= 14) {
    return usage.map((point) => ({
      key: point.date,
      label: formatUsageDayLabel(point.date),
      tooltipLabel: formatShortDate(point.date),
      dateKeys: [point.date],
      total: point.total,
    }))
  }

  const rows: UsageHeatmapRow[] = []
  for (let index = 0; index < usage.length; index += 7) {
    const chunk = usage.slice(index, index + 7)
    const first = chunk[0]
    const last = chunk[chunk.length - 1]
    rows.push({
      key: `${first.date}:${last.date}`,
      label: `${formatShortDate(first.date)} - ${formatShortDate(last.date)}`,
      tooltipLabel: `${formatShortDate(first.date)} - ${formatShortDate(last.date)}`,
      dateKeys: chunk.map((point) => point.date),
      total: usageTotalForPoints(chunk),
    })
  }
  return rows
}

function buildUsageHeatmapData(
  usage: UsagePoint[],
  range: UsagePageRange,
  sessions: SessionRecord[],
  costByDate: Map<string, number>,
): { rows: UsageHeatmapRow[]; cells: UsageHeatmapCell[] } {
  const rows = buildUsageHeatmapRows(usage, range)
  const sessionsByDateHour = new Map<string, number>()
  for (const session of sessions) {
    const updated = new Date(session.lastUpdated)
    const date = dateKeyFromTime(updated.getTime())
    const hour = updated.getHours()
    const key = `${date}:${hour}`
    sessionsByDateHour.set(key, (sessionsByDateHour.get(key) ?? 0) + 1)
  }
  const avgTokensPerSession = sessionTokenTotal(sessions) / Math.max(1, sessions.length)

  const cells = rows.flatMap((row, rowIndex) =>
    usageHours.map((hour) => {
      const variation = 0.82 + (((rowIndex + 1) * (hour + 3)) % 7) * 0.05
      const tokens = (row.total * usageHourlyWeights[hour] * variation) / usageHourlyWeightTotal
      const rowCost = costForDates(costByDate, row.dateKeys)
      const observedSessions = row.dateKeys.reduce(
        (count, date) => count + (sessionsByDateHour.get(`${date}:${hour}`) ?? 0),
        0,
      )
      const sessionsEstimate =
        observedSessions || (tokens > 0 ? Math.max(1, Math.round(tokens / avgTokensPerSession)) : 0)
      return {
        date: row.key,
        hour,
        tokens,
        sessions: sessionsEstimate,
        cost: costForTokenShare(tokens, row.total, rowCost),
      }
    }),
  )

  return { rows, cells }
}

function buildPeakWindows(cells: UsageHeatmapCell[], totalTokens: number): PeakWindow[] {
  const tokensByHour = usageHours.map((hour) =>
    cells.reduce((total, cell) => total + (cell.hour === hour ? cell.tokens : 0), 0),
  )

  return tokensByHour
    .map((tokens, hour) => ({ hour, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8)
    .map((window, index) => ({
      rank: index + 1,
      startHour: window.hour,
      endHour: (window.hour + 1) % 24,
      tokens: window.tokens,
      share: totalTokens > 0 ? (window.tokens / totalTokens) * 100 : 0,
      histogram: Array.from({ length: 7 }, (_, offset) => {
        const hour = (window.hour + offset - 3 + 24) % 24
        return tokensByHour[hour]
      }),
    }))
}

function buildAgentUsageRows(
  snapshot: DashboardSnapshot,
  sessions: SessionRecord[],
  usage: UsagePoint[],
): AgentUsage[] {
  const rows = snapshot.agents.map((agent) => {
    const sourceSessions = sessions.filter((session) => session.source === agent.source)
    const sessionTokens = sessionTokenTotal(sourceSessions)
    const usageTokens = usage.reduce((total, point) => total + point[agent.source], 0)
    const tokens = usageTokens || sessionTokens
    const cost = sessionCostTotal(sourceSessions)
    const hasTokenMetadata =
      tokens > 0 ||
      sourceSessions.some(
        (session) =>
          session.tokens.total > 0 ||
          session.tokens.input > 0 ||
          session.tokens.output > 0 ||
          session.tokens.cached > 0,
      )

    return {
      agent: agent.name,
      source: agent.source,
      tokens,
      cost,
      share: 0,
      hasTokenMetadata,
    }
  })
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  return rows.map((row) => ({ ...row, share: total > 0 ? (row.tokens / total) * 100 : 0 }))
}

function buildProjectUsageRows(
  sessions: SessionRecord[],
  usage: UsagePoint[],
  totalTokens: number,
  dateKeys: Set<string>,
  includeAllDates = false,
): ProjectUsage[] {
  const trendDates = usage.slice(-7).map((point) => point.date)
  const trendIndex = new Map(trendDates.map((date, index) => [date, index]))
  const projects = sessions.reduce<
    Record<
      string,
      {
        project: string
        projectPath?: string
        tokens: number
        cost: number
        trend: number[]
        costTrend: number[]
      }
    >
  >((acc, session) => {
    const key = session.projectName || session.projectPath || 'Unknown project'
    acc[key] ??= {
      project: session.projectName || 'Unknown project',
      projectPath: session.projectPath,
      tokens: 0,
      cost: 0,
      trend: Array.from({ length: Math.max(1, trendDates.length || 7) }, () => 0),
      costTrend: Array.from({ length: Math.max(1, trendDates.length || 7) }, () => 0),
    }
    acc[key].projectPath ??= session.projectPath

    const entries = sessionDateTokenEntries(session)
    const sessionEntryTotal = entries.reduce((total, [, tokens]) => total + tokens, 0)
    entries.forEach(([date, tokens]) => {
      if (!includeAllDates && !dateKeys.has(date)) return
      const cost =
        typeof session.tokens.costUsd === 'number' && session.tokens.costUsd > 0
          ? costForTokenShare(tokens, sessionEntryTotal, session.tokens.costUsd)
          : 0
      const index = trendIndex.get(date)
      acc[key].tokens += tokens
      acc[key].cost += cost
      if (index !== undefined) {
        acc[key].trend[index] += tokens
        acc[key].costTrend[index] += cost
      }
    })

    return acc
  }, {})

  return Object.values(projects)
    .map((row) => ({
      project: row.project,
      projectPath: row.projectPath,
      tokens: row.tokens,
      cost: row.cost,
      share: totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0,
      trend: row.trend,
      costTrend: row.costTrend,
      trendDates,
    }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}

function buildUsageAnalytics(snapshot: DashboardSnapshot, range: UsagePageRange) {
  const selectedUsage = usageForPageRange(snapshot.usage, range)
  const priorUsage = priorUsageForPageRange(snapshot.usage, range)
  const selectedDateKeys = new Set(selectedUsage.map((point) => point.date))
  const priorDateKeys = new Set(priorUsage.map((point) => point.date))
  const rangeSessions = rangeSessionsForUsage(snapshot.sessions, range, selectedDateKeys)
  const priorSessions = rangeSessionsForUsage(snapshot.sessions, range, priorDateKeys)
  const usageTokens = usageTotalForPoints(selectedUsage)
  const priorUsageTokens = usageTotalForPoints(priorUsage)
  const sessionTokens = sessionTokenTotalForDates(snapshot.sessions, selectedDateKeys)
  const priorSessionTokens = sessionTokenTotalForDates(snapshot.sessions, priorDateKeys)
  const totalTokens = usageTokens || sessionTokens || sessionTokenTotal(rangeSessions)
  const priorTokens =
    range === 'all' ? 0 : priorUsageTokens || priorSessionTokens || sessionTokenTotal(priorSessions)
  const allCostByDate = costByDateFromSessions(snapshot.sessions)
  const estimatedCost =
    range === 'all'
      ? sessionCostTotal(rangeSessions)
      : costForDates(allCostByDate, selectedDateKeys)
  const priorCost = range === 'all' ? 0 : costForDates(allCostByDate, priorDateKeys)
  const costCoverage =
    totalTokens > 0
      ? Math.min(
          100,
          ((range === 'all'
            ? sessionCostTokenTotal(rangeSessions)
            : sessionCostTokenTotalForDates(snapshot.sessions, selectedDateKeys)) /
            Math.max(1, totalTokens)) *
            100,
        )
      : 0
  const activeSessions = rangeSessions.length
  const avgTokensPerDay =
    totalTokens / Math.max(1, selectedUsage.length || usageDaysForPageRange(snapshot.usage, range))
  const tokenMix = usageTokenMixFromSessions(rangeSessions, totalTokens)
  const dailyTrend = attachDailyCosts(buildDailyUsageTrend(selectedUsage, tokenMix), allCostByDate)
  const heatmap = buildUsageHeatmapData(selectedUsage, range, rangeSessions, allCostByDate)
  const peakWindows = buildPeakWindows(heatmap.cells, totalTokens)
  const peakHour = peakWindows[0] ?? {
    rank: 1,
    startHour: 15,
    endHour: 16,
    tokens: 0,
    share: 0,
    histogram: [],
  }
  const summary: UsageSummary = {
    totalTokens,
    estimatedCost,
    costCoverage,
    activeSessions,
    avgTokensPerDay,
    peakHour: {
      startHour: peakHour.startHour,
      endHour: peakHour.endHour,
      tokens: peakHour.tokens,
    },
  }
  const agentRows = buildAgentUsageRows(snapshot, rangeSessions, selectedUsage)
  const projectRows = buildProjectUsageRows(
    snapshot.sessions,
    selectedUsage,
    totalTokens,
    selectedDateKeys,
    range === 'all',
  )

  return {
    selectedUsage,
    selectedDateKeys,
    summary,
    tokenMix,
    dailyTrend,
    heatmap,
    peakWindows,
    agentRows,
    projectRows,
    trends: {
      totalTokens: usageTrendDetail(totalTokens, priorTokens, 'tokens'),
      estimatedCost: usageTrendDetail(estimatedCost, priorCost, 'cost'),
      activeSessions: usageTrendDetail(activeSessions, priorSessions.length, 'sessions'),
      avgPerDay: usageTrendDetail(
        avgTokensPerDay,
        priorTokens /
          Math.max(1, priorUsage.length || usageDaysForPageRange(snapshot.usage, range)),
        'average',
      ),
    },
  }
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const escaped = cell.replace(/"/g, '""')
          return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped
        })
        .join(','),
    )
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportUsageCsv(snapshot: DashboardSnapshot, range: UsagePageRange): void {
  const analytics = buildUsageAnalytics(snapshot, range)
  downloadCsv(`clean-my-agent-usage-${range}.csv`, [
    ['Range', usagePageRangeLabel(range)],
    ['Total Tokens', String(Math.round(analytics.summary.totalTokens))],
    ['Known or Model-Priced Cost USD', analytics.summary.estimatedCost.toFixed(4)],
    ['Pricing Coverage', `${analytics.summary.costCoverage.toFixed(1)}%`],
    ['Active Sessions', String(analytics.summary.activeSessions)],
    ['Avg Tokens Per Day', String(Math.round(analytics.summary.avgTokensPerDay))],
    [],
    ['Date', 'Codex', 'Claude Code', 'Cursor', 'Gemini', 'OpenCode', 'Total'],
    ...analytics.selectedUsage.map((point) => [
      point.date,
      String(point.codex),
      String(point.claude),
      String(point.cursor),
      String(point.gemini),
      String(point.opencode),
      String(point.total),
    ]),
  ])
}

function MiniSparkline({
  data,
  color = '#60a5fa',
  className = '',
}: {
  data: number[]
  color?: string
  className?: string
}) {
  const path = createSparklinePath(data)
  return (
    <svg className={`usage-sparkline ${className}`} viewBox="0 0 96 32" aria-hidden="true">
      <path className="usage-sparkline-fill" d={`${path} L 96 32 L 0 32 Z`} fill={color} />
      <path
        className="usage-sparkline-glow usage-sparkline-glow-wide"
        d={path}
        fill="none"
        stroke={color}
        strokeLinecap="round"
      />
      <path
        className="usage-sparkline-glow usage-sparkline-glow-tight"
        d={path}
        fill="none"
        stroke={color}
        strokeLinecap="round"
      />
      <path
        className="usage-sparkline-line"
        d={path}
        fill="none"
        stroke={color}
        strokeLinecap="round"
      />
    </svg>
  )
}

function MiniHistogram({
  data,
  color = '#60a5fa',
  className = '',
}: {
  data: number[]
  color?: string
  className?: string
}) {
  const max = Math.max(...data, 1)
  return (
    <div
      className={`usage-mini-histogram ${className}`}
      style={{ '--usage-histogram-color': color } as CSSProperties}
      aria-hidden="true"
    >
      {data.map((value, index) => (
        <span key={index} style={{ height: `${Math.max(12, (value / max) * 100)}%` }} />
      ))}
    </div>
  )
}

function UsageKpiCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
  sparkline,
  sparklineColor,
  loading,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: string
  sparkline: number[]
  sparklineColor: string
  loading: boolean
}) {
  return (
    <Card className="metric-card usage-kpi-card rounded-lg py-4">
      <CardContent className="grid h-full grid-cols-[1fr_76px] items-center gap-3 px-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className={`grid size-7 shrink-0 place-items-center rounded-lg ${accent}`}>
              <Icon className="size-4" />
            </div>
            <span className="min-w-0 text-[11px] font-medium leading-tight text-white/62">
              {label}
            </span>
          </div>
          {loading ? (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-6 w-24 bg-white/10" />
              <Skeleton className="h-3 w-32 bg-white/8" />
            </div>
          ) : (
            <>
              <div className="mt-3 truncate text-[22px] font-semibold tracking-normal text-white">
                {value}
              </div>
              <div className="mt-0.5 truncate text-xs text-emerald-300">{detail}</div>
            </>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-9 w-full bg-white/8" />
        ) : (
          <MiniSparkline data={sparkline} color={sparklineColor} className="usage-kpi-sparkline" />
        )}
      </CardContent>
    </Card>
  )
}

function UsageSectionTitle({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <CardHeader className="pb-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm text-white">{title}</CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoButton />
              </TooltipTrigger>
              <TooltipContent>{description ?? title}</TooltipContent>
            </Tooltip>
          </div>
          {description && <p className="mt-1 text-xs text-white/42">{description}</p>}
        </div>
        {action}
      </div>
    </CardHeader>
  )
}

function InfoButton() {
  return (
    <button
      type="button"
      className="grid size-4 place-items-center rounded-full border border-white/16 text-[10px] font-semibold text-white/42"
      aria-label="More information"
    >
      i
    </button>
  )
}

function UsageHeatmapCard({ rows, cells }: { rows: UsageHeatmapRow[]; cells: UsageHeatmapCell[] }) {
  const [metric, setMetric] = useState<UsageHeatmapMetric>('tokens')
  const rowByKey = new Map(rows.map((row) => [row.key, row]))
  const max = Math.max(...cells.map((cell) => cell[metric]), 0)

  return (
    <Card className="glass-panel rounded-lg py-4">
      <UsageSectionTitle
        title="Token Activity Heatmap"
        description="Tokens by time of day and day (local time)."
        action={
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as UsageHeatmapMetric)}
            className="usage-native-select"
            aria-label="Heatmap metric"
          >
            {usageHeatmapMetrics.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        }
      />
      <CardContent>
        <div className="overflow-x-auto pb-1">
          <div
            className="usage-heatmap-grid"
            style={{
              gridTemplateColumns: `88px repeat(${usageHours.length}, 20px)`,
              gridTemplateRows: `22px repeat(${rows.length}, 20px)`,
            }}
          >
            <div />
            {usageHours.map((hour) => (
              <div key={hour} className="usage-heatmap-hour">
                {hour % 2 === 0 ? formatHourLabel(hour).replace(' ', '') : ''}
              </div>
            ))}
            {rows.map((row, rowIndex) => (
              <div
                key={row.key}
                className="usage-heatmap-row-label"
                style={{ gridColumn: 1, gridRow: rowIndex + 2 }}
              >
                {row.label}
              </div>
            ))}
            {cells.map((cell) => {
              const rowIndex = rows.findIndex((row) => row.key === cell.date)
              const level = heatLevel(cell[metric], max)
              const row = rowByKey.get(cell.date)
              return (
                <Tooltip key={`${cell.date}-${cell.hour}`}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="usage-heatmap-cell"
                      data-level={level}
                      style={{ gridColumn: cell.hour + 2, gridRow: rowIndex + 2 }}
                      aria-label={`${row?.tooltipLabel ?? cell.date}, ${formatHourRange(
                        cell.hour,
                        cell.hour + 1,
                      )}: ${formatUsageTokens(cell.tokens)} tokens`}
                    />
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    className="chart-tooltip usage-heatmap-tooltip rounded-lg px-3.5 py-3 shadow-xl"
                  >
                    <div className="text-xs font-semibold text-white/78">
                      {row?.tooltipLabel ?? cell.date}, {formatHourRange(cell.hour, cell.hour + 1)}
                    </div>
                    <div className="mt-2.5 space-y-2 text-[11px]">
                      <div className="usage-tooltip-row">
                        <span className="usage-tooltip-label">Tokens</span>
                        <span className="usage-tooltip-value text-blue-300">
                          {formatUsageTokens(cell.tokens)}
                        </span>
                      </div>
                      <div className="usage-tooltip-row">
                        <span className="usage-tooltip-label">Active sessions</span>
                        <span className="usage-tooltip-value text-white/72">
                          {cell.sessions.toLocaleString()}
                        </span>
                      </div>
                      <div className="usage-tooltip-row">
                        <span className="usage-tooltip-label">Cost</span>
                        <span className="usage-tooltip-value text-white/72">
                          {formatCost(cell.cost)}
                        </span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-white/42">
          <span>Low</span>
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} className="usage-heatmap-legend-cell" data-level={index + 1} />
          ))}
          <span>High</span>
        </div>
      </CardContent>
    </Card>
  )
}

function DailyUsageTrendTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean
  payload?: DailyUsageTooltipPayload[]
  label?: unknown
  metric: UsageTrendMetric
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const rows: Array<[UsageTokenType, number]> = [
    ['input', point?.input ?? 0],
    ['output', point?.output ?? 0],
    ['cache', point?.cache ?? 0],
    ['tools', point?.tools ?? 0],
  ]
  const formatter =
    metric === 'cost'
      ? (value: number) => formatCost(value)
      : (value: number) => formatUsageTokens(value)

  return (
    <div className="chart-tooltip min-w-48 rounded-lg px-3 py-2 shadow-xl">
      <div className="text-xs font-medium text-white/58">{String(label)}</div>
      <div className="mt-2 space-y-1">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-6 text-[11px]">
            <span className="flex items-center gap-1.5 text-white/50">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: usageTokenColors[key] }}
              />
              {usageTokenLabels[key].replace(' Tokens', '')}
            </span>
            <span className="font-mono text-white/70">{formatter(value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-6 border-t border-white/8 pt-2 text-xs">
        <span className="font-medium text-white">Total</span>
        <span className="font-mono font-semibold text-blue-300">
          {formatter(point?.total ?? 0)}
        </span>
      </div>
    </div>
  )
}

function DailyUsageTrendCard({ trend }: { trend: DailyUsageTrendPoint[] }) {
  const [metric, setMetric] = useState<UsageTrendMetric>('tokens')
  const chartData = trend.map((point) =>
    metric === 'cost'
      ? {
          ...point,
          input: costForTokenShare(point.input, point.total, point.cost),
          output: costForTokenShare(point.output, point.total, point.cost),
          cache: costForTokenShare(point.cache, point.total, point.cost),
          tools: costForTokenShare(point.tools, point.total, point.cost),
          total: point.cost,
        }
      : point,
  )

  return (
    <Card className="glass-panel rounded-lg py-4">
      <UsageSectionTitle
        title="Daily Usage Trend"
        description="Token usage over time by type."
        action={
          <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
            {usageTrendMetrics.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setMetric(item.value)}
                className={`h-6 rounded-md px-2 text-[11px] font-medium transition ${
                  metric === item.value
                    ? 'bg-white/14 text-white shadow-sm'
                    : 'text-white/45 hover:text-white/75'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />
      <CardContent className="h-[280px]">
        <ResponsiveContainer className="chart-static" width="100%" height="100%">
          <AreaChart
            data={chartData}
            accessibilityLayer={false}
            margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              {(Object.keys(usageTokenColors) as UsageTokenType[]).map((key) => (
                <linearGradient key={key} id={`usageArea-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={usageTokenColors[key]} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={usageTokenColors[key]} stopOpacity={0.08} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={18}
              tickFormatter={(value) => String(value).slice(5)}
            />
            <YAxis
              tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) =>
                metric === 'cost' ? formatCost(Number(value)) : formatUsageTokens(Number(value))
              }
            />
            <ChartTooltip
              content={<DailyUsageTrendTooltip metric={metric} />}
              cursor={{ stroke: 'rgba(147,197,253,.38)', strokeWidth: 1, strokeDasharray: '4 5' }}
              wrapperStyle={{ outline: 'none' }}
            />
            {(Object.keys(usageTokenColors) as UsageTokenType[]).map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="tokens"
                stroke={usageTokenColors[key]}
                strokeWidth={1.5}
                fill={`url(#usageArea-${key})`}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function ByAgentCard({ rows }: { rows: AgentUsage[] }) {
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)

  return (
    <Card className="glass-panel rounded-lg py-4">
      <UsageSectionTitle title="By Agent" description="Token usage share by local agent." />
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.source} className="text-xs">
            <div className="grid grid-cols-[96px_1fr_72px_48px] items-center gap-3">
              <span className="truncate text-white/78">{row.agent}</span>
              {row.hasTokenMetadata ? (
                <>
                  <div className="usage-agent-meter">
                    <span
                      style={{
                        width: `${row.share}%`,
                        background: `linear-gradient(90deg, ${sourceColors[row.source]}, color-mix(in srgb, ${sourceColors[row.source]} 70%, white 20%))`,
                      }}
                    />
                  </div>
                  <span className="text-right text-white/64">{formatUsageTokens(row.tokens)}</span>
                  <span className="text-right text-white/54">{formatUsageShare(row.share)}</span>
                </>
              ) : (
                <span className="col-span-3 text-white/38">No token metadata available</span>
              )}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[96px_1fr_72px_48px] items-center gap-3 border-t border-white/8 pt-3 text-xs">
          <span className="text-white/58">Total</span>
          <span />
          <span className="text-right text-white/62">{formatUsageTokens(total)}</span>
          <span className="text-right text-white/54">{total > 0 ? '100%' : '--'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function TokenMixCard({ mix }: { mix: TokenMix }) {
  const total = mix.input + mix.output + mix.cache + mix.tools
  const rows = (Object.keys(usageTokenColors) as UsageTokenType[]).map((key) => ({
    key,
    value: mix[key],
    share: total > 0 ? (mix[key] / total) * 100 : 0,
  }))
  const visibleRows = rows.filter((row) => row.value > 0)
  const visualRows = visibleRows.map((row) => ({
    ...row,
    visualShare: row.share > 0 && row.share < 2 && visibleRows.length > 1 ? 7 : row.share,
  }))
  const visualTotal = visualRows.reduce((sum, row) => sum + row.visualShare, 0)

  return (
    <Card className="glass-panel rounded-lg py-4">
      <UsageSectionTitle title="Token Mix" description={`Total ${formatUsageTokens(total)}`} />
      <CardContent>
        <div className="usage-token-mix-bar">
          {visualRows
            .map((row) => ({
              ...row,
              displayShare: visualTotal > 0 ? (row.visualShare / visualTotal) * 100 : 0,
            }))
            .map((row) => (
              <Tooltip key={row.key}>
                <TooltipTrigger asChild>
                  <span
                    style={{
                      flexBasis: `${row.displayShare}%`,
                      backgroundColor: usageTokenColors[row.key],
                    }}
                    data-small={row.share > 0 && row.share < 2 ? 'true' : undefined}
                  >
                    {row.share >= 8 ? (
                      <span>
                        {usageTokenLabels[row.key].replace(' Tokens', '')}{' '}
                        {formatUsageShare(row.share)}
                      </span>
                    ) : row.share > 0 ? (
                      <span>{formatUsageShare(row.share)}</span>
                    ) : null}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="chart-tooltip rounded-lg px-3 py-2 shadow-xl">
                  {usageTokenLabels[row.key]}: {formatUsageTokens(row.value)} (
                  {formatUsageShare(row.share)})
                </TooltipContent>
              </Tooltip>
            ))}
        </div>
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[1fr_82px_52px] items-center gap-3 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2 text-white/70">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: usageTokenColors[row.key] }}
                />
                <span className="truncate">{usageTokenLabels[row.key]}</span>
              </span>
              <span className="text-right text-white/58">{formatUsageTokens(row.value)}</span>
              <span className="text-right text-white/45">{formatUsageShare(row.share)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PriceRankingCard({
  projects,
  onSelectProject,
}: {
  projects: ProjectUsage[]
  onSelectProject: (project?: ProjectUsage) => void
}) {
  const visibleProjects = projects
    .filter((project) => project.cost > 0 || project.tokens > 0)
    .slice(0, 5)
  const totalCost = projects.reduce((sum, project) => sum + project.cost, 0)
  const topCostDay = projects
    .flatMap((project) =>
      project.costTrend.map((cost, index) => ({
        cost,
        date: project.trendDates[index],
      })),
    )
    .sort((a, b) => b.cost - a.cost)[0]

  return (
    <Card className="glass-panel rounded-lg py-4">
      <UsageSectionTitle
        title="Price Ranking / Top Cost Projects"
        description="Top projects by estimated cost."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectProject(undefined)}
            className="text-white/65 hover:bg-white/7 hover:text-white"
          >
            View all
          </Button>
        }
      />
      <CardContent className="space-y-2">
        {visibleProjects.map((project, index) => (
          <button
            key={`${project.project}-${project.projectPath ?? ''}`}
            type="button"
            onClick={() => onSelectProject(project)}
            className="grid w-full grid-cols-[26px_minmax(0,1fr)_88px_82px] items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition hover:bg-white/[0.035]"
          >
            <span className="grid size-5 place-items-center rounded bg-white/8 text-[11px] font-semibold text-white/55">
              {index + 1}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate font-medium text-white/76">
                  {project.projectPath ?? project.project}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                {project.projectPath ?? project.project}
              </TooltipContent>
            </Tooltip>
            <span className="text-right text-white/66">{formatCost(project.cost)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="justify-self-end">
                  <MiniSparkline data={project.costTrend} color="#60a5fa" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="chart-tooltip rounded-lg px-3 py-2 shadow-xl">
                {formatUsageTokens(project.tokens)} tokens, {formatUsageShare(project.share)} share
              </TooltipContent>
            </Tooltip>
          </button>
        ))}
        {visibleProjects.length === 0 && (
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-3 text-xs text-white/42">
            No project cost metadata available
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-white/8 bg-white/[0.03] p-2.5 text-xs">
          <div className="min-w-0">
            <div className="text-white/42">Total Estimated Cost</div>
            <div className="mt-1 font-semibold text-white/82">{formatCost(totalCost)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-white/42">Highest Cost Day</div>
            <div className="mt-1 truncate font-semibold text-white/82">
              {topCostDay && topCostDay.cost > 0
                ? `${formatShortDate(topCostDay.date)} ${formatCost(topCostDay.cost)}`
                : 'No cost data'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PeakActivityWindowsCard({ windows }: { windows: PeakWindow[] }) {
  const visibleWindows = windows.slice(0, 8)

  return (
    <Card className="glass-panel usage-peak-card rounded-lg py-4">
      <UsageSectionTitle
        title="Peak Activity Windows"
        description="Highest token usage windows in the selected period."
      />
      <CardContent>
        {visibleWindows.length > 0 ? (
          <div className="usage-peak-layout">
            {visibleWindows.map((window, index) => (
              <div
                key={window.rank}
                className="usage-peak-window usage-peak-window-compact"
                style={
                  {
                    '--usage-peak-color': usagePeakColors[index % usagePeakColors.length],
                  } as CSSProperties
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Badge className="usage-peak-rank">#{window.rank}</Badge>
                    <div className="mt-2 truncate text-sm font-semibold text-white/84">
                      {formatHourRange(window.startHour, window.endHour)}
                    </div>
                    <div className="mt-1 text-xs text-white/48">
                      {formatUsageTokens(window.tokens)} tokens
                    </div>
                  </div>
                  <div className="text-right text-[11px] font-medium text-white/42">
                    {formatUsageShare(window.share)}
                  </div>
                </div>
                <MiniHistogram
                  data={window.histogram}
                  color={usagePeakColors[index % usagePeakColors.length]}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-3 text-xs text-white/42">
            No peak activity windows available
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UsageEmptyView() {
  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardContent className="grid min-h-[360px] place-items-center text-center">
        <div>
          <div className="text-base font-medium text-white">No usage data yet</div>
          <p className="mt-2 text-sm text-white/42">
            Usage analytics will appear after your local sessions are indexed.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function UsageLoadingView() {
  return (
    <div className="usage-page space-y-4">
      <section className="usage-kpi-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <UsageKpiCard
            key={index}
            icon={Activity}
            label="Loading"
            value=""
            detail=""
            accent="bg-white/8 text-white/50"
            sparkline={[]}
            sparklineColor="#60a5fa"
            loading
          />
        ))}
      </section>
      <section className="usage-main-grid">
        <div className="space-y-4">
          <Card className="glass-panel rounded-lg py-4">
            <UsageSectionTitle title="Token Activity Heatmap" />
            <CardContent>
              <div className="grid grid-cols-[88px_repeat(24,20px)] gap-1.5 overflow-hidden">
                {Array.from({ length: 7 * 24 }, (_, index) => (
                  <Skeleton key={index} className="size-4 rounded-sm bg-white/8" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="glass-panel rounded-lg py-4">
            <UsageSectionTitle title="Daily Usage Trend" />
            <CardContent className="space-y-3">
              <Skeleton className="h-[220px] w-full bg-white/8" />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="glass-panel rounded-lg py-4">
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-28 bg-white/10" />
                <Skeleton className="h-20 w-full bg-white/8" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section className="usage-bottom-grid">
        <Card className="glass-panel rounded-lg py-4">
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-40 bg-white/10" />
            <Skeleton className="h-36 w-full bg-white/8" />
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-lg py-4">
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-28 bg-white/10" />
            <Skeleton className="h-24 w-full bg-white/8" />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
function UsageView({
  snapshot,
  range,
  loading,
  onSelectProject,
}: {
  snapshot: DashboardSnapshot
  range: UsagePageRange
  loading: boolean
  onSelectProject: (project?: ProjectUsage) => void
}) {
  const analytics = useMemo(() => buildUsageAnalytics(snapshot, range), [snapshot, range])

  if (loading) return <UsageLoadingView />
  if (analytics.summary.totalTokens <= 0 && analytics.summary.activeSessions <= 0) {
    return <UsageEmptyView />
  }

  const sparkline = usageSparklineTrend(analytics.selectedUsage)
  const costSparkline = analytics.dailyTrend.slice(-12).map((point) => point.cost)
  const sessionsTrend = analytics.selectedUsage.map((point, index) =>
    Math.max(
      0,
      Math.round((point.total / Math.max(1, analytics.summary.avgTokensPerDay)) * (index + 4)),
    ),
  )

  return (
    <div className="usage-page space-y-4">
      <section className="usage-kpi-grid">
        <UsageKpiCard
          icon={Gauge}
          label="Total Tokens"
          value={formatUsageTokens(analytics.summary.totalTokens)}
          detail={analytics.trends.totalTokens}
          accent="bg-violet-400/12 text-violet-300"
          sparkline={sparkline}
          sparklineColor="#a78bfa"
          loading={false}
        />
        <UsageKpiCard
          icon={Database}
          label="Estimated Cost"
          value={formatCost(analytics.summary.estimatedCost)}
          detail={`Pricing coverage ${analytics.summary.costCoverage.toFixed(1)}%`}
          accent="bg-teal-400/12 text-teal-300"
          sparkline={costSparkline}
          sparklineColor="#2dd4bf"
          loading={false}
        />
        <UsageKpiCard
          icon={Bot}
          label="Active Sessions"
          value={analytics.summary.activeSessions.toLocaleString()}
          detail={analytics.trends.activeSessions}
          accent="bg-blue-400/12 text-blue-300"
          sparkline={sessionsTrend}
          sparklineColor="#60a5fa"
          loading={false}
        />
        <UsageKpiCard
          icon={ChartNoAxesColumn}
          label="Avg / Day"
          value={formatUsageTokens(analytics.summary.avgTokensPerDay)}
          detail={analytics.trends.avgPerDay}
          accent="bg-amber-400/12 text-amber-300"
          sparkline={sparkline}
          sparklineColor="#fb923c"
          loading={false}
        />
        <UsageKpiCard
          icon={Clock}
          label="Peak Hour"
          value={formatHourRange(
            analytics.summary.peakHour.startHour,
            analytics.summary.peakHour.endHour,
          )}
          detail={`${formatUsageTokens(analytics.summary.peakHour.tokens)} tokens`}
          accent="bg-purple-400/12 text-purple-300"
          sparkline={analytics.peakWindows[0]?.histogram ?? sparkline}
          sparklineColor="#c084fc"
          loading={false}
        />
      </section>

      <section className="usage-main-grid">
        <div className="space-y-4">
          <UsageHeatmapCard rows={analytics.heatmap.rows} cells={analytics.heatmap.cells} />
          <DailyUsageTrendCard trend={analytics.dailyTrend} />
        </div>
        <div className="space-y-4">
          <ByAgentCard rows={analytics.agentRows} />
          <PriceRankingCard projects={analytics.projectRows} onSelectProject={onSelectProject} />
        </div>
      </section>

      <section className="usage-bottom-grid">
        <PeakActivityWindowsCard windows={analytics.peakWindows} />
        <TokenMixCard mix={analytics.tokenMix} />
      </section>
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
          <p className="mt-1 text-xs text-white/42">
            V0 extracts chats into a common schema. Agent-specific converters can target Codex,
            Claude Code, Cursor, Gemini, or OpenCode later.
          </p>
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
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Export Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
          >
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {agentLabel[item.source]} · {item.title}
              </option>
            ))}
          </select>
          {session && (
            <div className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <AgentGlyph source={session.source} />
                <span className="text-sm font-medium text-white/82">{session.title}</span>
              </div>
              <div className="mt-3 space-y-1 text-xs text-white/42">
                <div>{session.projectName}</div>
                <div>
                  {session.messageCount} messages · {formatTokens(session.tokens.total)} tokens
                </div>
              </div>
            </div>
          )}
          <Button
            disabled={!session}
            onClick={() => session && void onRelay(session.id)}
            className="w-full bg-blue-500 text-white hover:bg-blue-400"
          >
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
                <Badge
                  className={
                    agent.readable
                      ? 'bg-emerald-400/10 text-emerald-300'
                      : 'bg-amber-400/10 text-amber-300'
                  }
                >
                  {agent.readable ? 'Readable' : 'Not found'}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-white/42">
                {agent.sessionCount} sessions · {formatBytes(agent.sizeBytes)}
              </div>
              <div className="mt-3 space-y-1">
                {agent.rootPaths.map((root) => (
                  <div
                    key={root}
                    className="truncate rounded border border-white/7 bg-white/[0.03] px-2 py-1 text-[11px] text-white/38"
                  >
                    {root}
                  </div>
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
          <p className="mt-1 text-xs text-white/42">
            Switch between live local scan results and a balanced demo dataset for visual review.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-white/[0.035] p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white/82">Demo data</div>
              <div className="mt-1 text-xs leading-5 text-white/42">
                Overview, Usage, Cleanup, Sessions, Relay, and Health use curated mock values while
                enabled.
              </div>
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
  const [usageRange, setUsageRange] = useState<UsagePageRange>('7d')
  const [sessionProjectQuery, setSessionProjectQuery] = useState('')
  const dashboard = useDashboard()
  const theme = useTheme()

  const content = useMemo(() => {
    switch (activeView) {
      case 'overview':
        return (
          <OverviewView
            snapshot={dashboard.snapshot}
            usageRange={overviewRange}
            loading={dashboard.loading}
            onRefresh={dashboard.refreshRecentSessions}
            onSelectCleanup={() => setActiveView('cleanup')}
          />
        )
      case 'sessions':
        return (
          <SessionsView
            key={sessionProjectQuery || 'all-sessions'}
            sessions={dashboard.snapshot.sessions}
            archives={dashboard.snapshot.archives}
            initialQuery={sessionProjectQuery}
            onBackup={dashboard.backupSession}
            onArchive={dashboard.archiveSession}
            onRestoreArchive={dashboard.restoreArchive}
            onExport={(id) => dashboard.exportSession(id, 'markdown')}
            onRelay={dashboard.exportUniversalRelay}
          />
        )
      case 'cleanup':
        return (
          <CleanupView
            cleanup={dashboard.snapshot.cleanup}
            agents={dashboard.snapshot.agents}
            sessions={dashboard.snapshot.sessions}
            onScanCleanup={dashboard.scanCleanup}
            onMoveToTrash={dashboard.moveCleanupToTrash}
          />
        )
      case 'usage':
        return (
          <UsageView
            snapshot={dashboard.snapshot}
            range={usageRange}
            loading={dashboard.loading}
            onSelectProject={(project) => {
              setSessionProjectQuery(project?.projectPath ?? project?.project ?? '')
              setActiveView('sessions')
            }}
          />
        )
      case 'relay':
        return (
          <RelayView
            sessions={dashboard.snapshot.sessions}
            onRelay={dashboard.exportUniversalRelay}
          />
        )
      case 'health':
        return <HealthView snapshot={dashboard.snapshot} />
      case 'settings':
        return (
          <SettingsView
            mockDataEnabled={dashboard.mockDataEnabled}
            onMockDataChange={dashboard.setMockDataEnabled}
          />
        )
      default:
        return null
    }
  }, [activeView, dashboard, overviewRange, sessionProjectQuery, usageRange])

  return (
    <TooltipProvider>
      <div
        className={`mac-window theme-${theme.resolvedTheme} flex h-screen overflow-hidden text-white`}
      >
        <Sidebar
          activeView={activeView}
          setActiveView={setActiveView}
          snapshot={dashboard.snapshot}
        />
        <main className="main-surface soft-grid flex min-w-0 flex-1 flex-col">
          <Topbar
            activeView={activeView}
            loading={dashboard.loading}
            mockDataEnabled={dashboard.mockDataEnabled}
            overviewRange={overviewRange}
            usageRange={usageRange}
            resolvedTheme={theme.resolvedTheme}
            onThemeToggle={() =>
              theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark')
            }
            onOverviewRangeChange={setOverviewRange}
            onUsageRangeChange={setUsageRange}
            onUsageExport={() => exportUsageCsv(dashboard.snapshot, usageRange)}
            onRescan={dashboard.rescan}
          />
          <div
            className={`content-scroll no-drag-region min-h-0 flex-1 ${
              activeView === 'cleanup' ? 'overflow-hidden' : 'overflow-auto'
            }`}
          >
            <div
              className={
                activeView === 'cleanup'
                  ? 'cleanup-app-panel h-full min-w-[1120px]'
                  : 'min-w-[1120px] p-5'
              }
            >
              {content}
            </div>
          </div>
        </main>
      </div>
      <Toaster theme={theme.resolvedTheme} position="top-right" />
    </TooltipProvider>
  )
}

export default App
