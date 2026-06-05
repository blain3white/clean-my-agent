import { type CSSProperties, useState } from 'react'
import {
  Archive,
  ChartNoAxesColumn,
  ChartSpline,
  Circle,
  Database,
  Gauge,
  Grid3X3,
  HardDrive,
  ListFilter,
  Loader2,
  RefreshCcw,
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
import { AgentGlyph } from '@/components/agent-glyph'
import { MetricCard } from '@/components/metric-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sourceColors } from '@/lib/agent-colors'
import { dateKeyFromTime } from '@/lib/date-key'
import { agentLabel, formatBytes, formatRelative, formatTokens, riskAccent } from '@/lib/format'
import { sessionTokenTotalForDates } from '@/lib/usage-sessions'
import {
  agentSources,
  type AgentSource,
  type CleanupCandidate,
  type DashboardSnapshot,
  type SessionRecord,
  type UsagePoint,
} from '@/shared/types'
import type { UsageRange } from '@/features/usage/ranges'

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

export function OverviewView({
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
