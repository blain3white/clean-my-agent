import { type ReactNode, useMemo, useState } from 'react'
import {
  Activity,
  Bot,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Gauge,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sourceColors } from '@/lib/agent-colors'
import { formatCost } from '@/lib/format'
import type { DashboardSnapshot } from '@/shared/types'
import type { UsagePageRange } from '@/features/usage/ranges'
import {
  buildUsageAnalytics,
  costForTokenShare,
  createSparklinePath,
  formatHourLabel,
  formatHourRange,
  formatShortDate,
  formatUsageShare,
  formatUsageTokens,
  heatLevel,
  usageHours,
  usageSparklineTrend,
  usageTokenColors,
  usageTokenLabels,
  type AgentUsage,
  type DailyUsageTooltipPayload,
  type DailyUsageTrendPoint,
  type PeakWindow,
  type ProjectUsage,
  type TokenMix,
  type UsageHeatmapCell,
  type UsageHeatmapRow,
  type UsageTokenType,
} from '@/features/usage/usage-analytics'

const usageHeatmapMetrics: Array<{ value: UsageHeatmapMetric; label: string }> = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'cost', label: 'Cost' },
]
const usageTrendMetrics: Array<{ value: UsageTrendMetric; label: string }> = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: 'Cost' },
]

type UsageHeatmapMetric = 'tokens' | 'sessions' | 'cost'
type UsageTrendMetric = 'tokens' | 'cost'

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

function PeakActivityChart({ windows }: { windows: PeakWindow[] }) {
  const profile = usageHours.map((hour) => {
    const exact = windows.find((window) => window.startHour === hour)
    if (exact) return exact.tokens

    const samples = windows.flatMap((window) =>
      window.histogram
        .map((tokens, index) => ({
          hour: (window.startHour + index - 3 + 24) % 24,
          tokens,
        }))
        .filter((sample) => sample.hour === hour)
        .map((sample) => sample.tokens),
    )

    return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0
  })
  const max = Math.max(...profile, 1)
  const points = profile.map((value, index) => {
    const x = 8 + (index / 23) * 304
    const y = 142 - (value / max) * 118
    return { x, y }
  })
  const linePath = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    const previous = points[index - 1]
    const controlOffset = (point.x - previous.x) / 2
    return `${path} C ${(previous.x + controlOffset).toFixed(2)} ${previous.y.toFixed(2)}, ${(point.x - controlOffset).toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }, '')
  const areaPath = `${linePath} L 312 152 L 8 152 Z`
  const topPoint = points[Math.max(0, profile.indexOf(max))]
  const axisLabels = [
    { hour: 0, label: '12 AM' },
    { hour: 4, label: '4 AM' },
    { hour: 8, label: '8 AM' },
    { hour: 12, label: '12 PM' },
    { hour: 16, label: '4 PM' },
    { hour: 20, label: '8 PM' },
    { hour: 24, label: '12 AM' },
  ]

  return (
    <div className="usage-peak-chart" aria-hidden="true">
      <svg viewBox="0 0 320 178" preserveAspectRatio="none">
        <defs>
          <linearGradient id="usagePeakArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f8cff" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#4f8cff" stopOpacity="0.04" />
          </linearGradient>
          <filter id="usagePeakGlow" x="-20%" y="-30%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0, 4, 8, 12, 16, 20, 24].map((hour) => {
          const x = 8 + (hour / 24) * 304
          return (
            <line key={hour} x1={x} x2={x} y1="18" y2="152" className="usage-peak-chart-grid" />
          )
        })}
        <path d={areaPath} fill="url(#usagePeakArea)" />
        <path
          d={linePath}
          className="usage-peak-chart-glow"
          fill="none"
          filter="url(#usagePeakGlow)"
        />
        <path d={linePath} className="usage-peak-chart-line" fill="none" />
        <circle
          cx={topPoint?.x ?? 0}
          cy={topPoint?.y ?? 0}
          r="3.2"
          className="usage-peak-chart-dot"
        />
        <line x1="8" x2="312" y1="152" y2="152" className="usage-peak-chart-axis" />
      </svg>
      <div className="usage-peak-chart-labels">
        {axisLabels.map((item) => (
          <span key={item.hour}>{item.label}</span>
        ))}
      </div>
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
  const visibleWindows = windows.slice(0, 5)
  const topWindow = visibleWindows[0]

  return (
    <Card className="glass-panel usage-peak-card rounded-lg py-4">
      <UsageSectionTitle
        title="Peak Activity Windows"
        description="Highest token usage windows in the selected period."
        action={
          <button type="button" className="usage-peak-timezone" aria-label="Peak activity timezone">
            <Clock className="size-3.5" />
            <span>Local time (UTC-7)</span>
            <ChevronDown className="size-3.5" />
          </button>
        }
      />
      <CardContent>
        {topWindow ? (
          <div className="usage-peak-layout">
            <div className="usage-peak-feature">
              <div className="text-xs font-medium text-white/42">Top window</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div className="text-[26px] font-semibold leading-none tracking-normal text-white">
                  {formatHourRange(topWindow.startHour, topWindow.endHour)}
                </div>
                <Badge className="usage-peak-share-badge">
                  <span />
                  {formatUsageShare(topWindow.share)}
                </Badge>
              </div>
              <div className="mt-2 text-sm font-medium text-white/46">
                {formatUsageTokens(topWindow.tokens)} tokens
              </div>
              <PeakActivityChart windows={windows} />
              <div className="usage-peak-chart-caption">
                <Clock className="size-3.5" />
                <span>Local time (UTC-7)</span>
              </div>
            </div>
            <div className="usage-peak-ranking">
              {visibleWindows.map((window, index) => (
                <div
                  key={window.rank}
                  className="usage-peak-row"
                  data-active={index === 0 ? 'true' : undefined}
                >
                  <span className="usage-peak-row-rank">{window.rank}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white/84">
                      {formatHourRange(window.startHour, window.endHour)}
                    </span>
                    <span className="mt-0.5 block text-xs text-white/42">
                      {formatUsageTokens(window.tokens)} tokens
                    </span>
                  </span>
                  <span className="text-right text-sm font-medium text-white/50">
                    {formatUsageShare(window.share)}
                  </span>
                </div>
              ))}
              <button type="button" className="usage-peak-breakdown">
                <span>View full breakdown</span>
                <ChevronRight className="size-4" />
              </button>
            </div>
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
export function UsageView({
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
