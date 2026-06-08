import { dateKeyFromTime } from '@/lib/date-key'
import { sessionDateTokenEntries, sessionTokenTotalForDates } from '@/lib/usage-sessions'
import {
  agentSources,
  type AgentSource,
  type DashboardSnapshot,
  type SessionRecord,
  type UsagePoint,
} from '@/shared/types'
import { agentLabel } from '@/lib/format'
import { usagePageRanges, type UsagePageRange } from '@/features/usage/ranges'

export type UsageTokenType = 'input' | 'output' | 'cache' | 'tools'

export type UsageSummary = {
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
export type UsageHeatmapCell = {
  date: string
  hour: number
  tokens: number
  sessions: number
  cost: number
}
export type TokenMix = {
  input: number
  output: number
  cache: number
  tools: number
}
export type AgentUsage = {
  agent: string
  source: AgentSource
  tokens: number
  cost: number
  share: number
  hasTokenMetadata: boolean
}
export type ProjectUsage = {
  project: string
  projectPath?: string
  tokens: number
  cost: number
  share: number
  trend: number[]
  costTrend: number[]
  trendDates: string[]
}
export type PeakWindow = {
  rank: number
  startHour: number
  endHour: number
  tokens: number
  share: number
  histogram: number[]
}
export type DailyUsageTrendPoint = {
  date: string
  input: number
  output: number
  cache: number
  tools: number
  total: number
  cost: number
}
export type UsageForecastPeriod = 'week' | 'month'
export type UsageForecastConfidence = 'low' | 'medium' | 'high'
export type UsageForecastMetric = 'tokens' | 'cost'
export type UsageForecastAlert = {
  id: string
  period: UsageForecastPeriod
  metric: UsageForecastMetric
  severity: 'warning' | 'critical'
  deltaPercent: number
  projectedValue: number
  baselineValue: number
}
export type UsageForecast = {
  period: UsageForecastPeriod
  label: string
  startDate: string
  endDate: string
  elapsedDays: number
  totalDays: number
  observedTokens: number
  observedCost: number
  projectedTokens: number
  projectedCost: number
  baselineTokens: number
  baselineCost: number
  tokenChangePercent: number | null
  costChangePercent: number | null
  confidence: UsageForecastConfidence
}
export type UsageForecasts = {
  week: UsageForecast
  month: UsageForecast
  alerts: UsageForecastAlert[]
}

export type DailyUsageTooltipPayload = {
  dataKey?: string
  value?: unknown
  payload?: DailyUsageTrendPoint
}

export const usageTokenLabels: Record<UsageTokenType, string> = {
  input: 'Input Tokens',
  output: 'Output Tokens',
  cache: 'Cache Tokens',
  tools: 'Tool Tokens',
}
export const usageTokenColors: Record<UsageTokenType, string> = {
  input: '#a78bfa',
  output: '#38bdf8',
  cache: '#fb923c',
  tools: '#4ade80',
}
export const usagePeakColors = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#38bdf8', '#c084fc']
export const usageHours = Array.from({ length: 24 }, (_, hour) => hour)
const usageDefaultMix: TokenMix = { input: 0.506, output: 0.36, cache: 0.106, tools: 0.028 }

export function usageDaysForPageRange(usage: UsagePoint[], range: UsagePageRange): number {
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

export function heatLevel(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(9, Math.ceil((value / max) * 9))
}

export function formatUsageTokens(tokens: number): string {
  const value = Math.max(0, tokens)
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

export function formatUsageShare(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24
  if (normalized === 0) return '12 AM'
  if (normalized === 12) return '12 PM'
  return normalized > 12 ? `${normalized - 12} PM` : `${normalized} AM`
}

export function formatHourRange(startHour: number, endHour: number): string {
  return `${formatHourLabel(startHour)} - ${formatHourLabel(endHour)}`
}

export function formatShortDate(date: string): string {
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

export function costForTokenShare(tokens: number, totalTokens: number, totalCost: number): number {
  if (tokens <= 0 || totalTokens <= 0 || totalCost <= 0) return 0
  return (tokens / totalTokens) * totalCost
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

type UsageDailyRecord = {
  date: string
  tokens: number
  cost: number
}

const usageMsPerDay = 24 * 60 * 60 * 1000

function parseUsageDate(date: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined
  }

  return parsed
}

function dateKeyFromUsageDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUsageDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * usageMsPerDay)
}

function usageDaysBetweenInclusive(start: Date, end: Date): number {
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / usageMsPerDay) + 1)
}

function startOfUsageWeek(date: Date): Date {
  const weekday = date.getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addUsageDays(date, offset)
}

function startOfUsageMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function endOfUsageMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
}

function fallbackForecastDate(generatedAt: string): Date {
  const parsed = new Date(generatedAt)
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
  }
  return new Date(Date.UTC(1970, 0, 1))
}

function dailyRecordsFromUsage(
  usage: UsagePoint[],
  costByDate: Map<string, number>,
): UsageDailyRecord[] {
  const records = new Map<string, UsageDailyRecord>()

  for (const point of usage) {
    if (!parseUsageDate(point.date)) continue
    const existing = records.get(point.date)
    records.set(point.date, {
      date: point.date,
      tokens: (existing?.tokens ?? 0) + point.total,
      cost: (existing?.cost ?? 0) + (costByDate.get(point.date) ?? 0),
    })
  }

  return Array.from(records.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function sumDailyRecordMetric(
  records: UsageDailyRecord[],
  start: Date,
  end: Date,
  metric: 'tokens' | 'cost',
): number {
  const startKey = dateKeyFromUsageDate(start)
  const endKey = dateKeyFromUsageDate(end)
  return records.reduce((total, record) => {
    if (record.date < startKey || record.date > endKey) return total
    return total + record[metric]
  }, 0)
}

function trailingDailyMetric(
  records: UsageDailyRecord[],
  periodStart: Date,
  days: number,
  metric: 'tokens' | 'cost',
): number {
  const end = addUsageDays(periodStart, -1)
  const start = addUsageDays(periodStart, -days)
  return sumDailyRecordMetric(records, start, end, metric)
}

function latestUsageRecordDate(records: UsageDailyRecord[], generatedAt: string): Date {
  const lastRecord = records.at(-1)
  return lastRecord
    ? (parseUsageDate(lastRecord.date) ?? fallbackForecastDate(generatedAt))
    : fallbackForecastDate(generatedAt)
}

function historicalCostPerToken(records: UsageDailyRecord[]): number {
  const priced = records.filter((record) => record.tokens > 0 && record.cost > 0)
  const tokens = priced.reduce((total, record) => total + record.tokens, 0)
  const cost = priced.reduce((total, record) => total + record.cost, 0)
  return tokens > 0 ? cost / tokens : 0
}

function percentChange(current: number, baseline: number): number | null {
  if (baseline <= 0) return null
  return ((current - baseline) / baseline) * 100
}

function usageForecastConfidence(
  records: UsageDailyRecord[],
  periodStart: Date,
  elapsedDays: number,
  totalDays: number,
  observedTokens: number,
): UsageForecastConfidence {
  if (observedTokens <= 0) return 'low'
  const startKey = dateKeyFromUsageDate(periodStart)
  const historyDays = records.filter(
    (record) => record.date < startKey && (record.tokens > 0 || record.cost > 0),
  ).length

  if (elapsedDays >= Math.ceil(totalDays * 0.5) && historyDays >= totalDays) return 'high'
  if (elapsedDays >= 2 && historyDays >= Math.min(7, totalDays)) return 'medium'
  return 'low'
}

function buildPeriodForecast(
  period: UsageForecastPeriod,
  label: string,
  latestDate: Date,
  records: UsageDailyRecord[],
  costPerToken: number,
): UsageForecast {
  const start = period === 'week' ? startOfUsageWeek(latestDate) : startOfUsageMonth(latestDate)
  const end = period === 'week' ? addUsageDays(start, 6) : endOfUsageMonth(latestDate)
  const previousStart =
    period === 'week'
      ? addUsageDays(start, -7)
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))
  const previousEnd = period === 'week' ? addUsageDays(start, -1) : endOfUsageMonth(previousStart)
  const totalDays = usageDaysBetweenInclusive(start, end)
  const elapsedDays = Math.min(totalDays, usageDaysBetweenInclusive(start, latestDate))
  const observedEnd = latestDate > end ? end : latestDate
  const observedTokens = sumDailyRecordMetric(records, start, observedEnd, 'tokens')
  const observedCost = sumDailyRecordMetric(records, start, observedEnd, 'cost')
  const projectedTokens = observedTokens > 0 ? (observedTokens / elapsedDays) * totalDays : 0
  const projectedObservedCost = observedCost > 0 ? (observedCost / elapsedDays) * totalDays : 0
  const projectedRateCost = costPerToken > 0 ? projectedTokens * costPerToken : 0
  const projectedCost = projectedObservedCost || projectedRateCost
  const previousTokens = sumDailyRecordMetric(records, previousStart, previousEnd, 'tokens')
  const previousCost = sumDailyRecordMetric(records, previousStart, previousEnd, 'cost')
  const baselineTokens = previousTokens || trailingDailyMetric(records, start, totalDays, 'tokens')
  const baselineCost =
    previousCost ||
    (costPerToken > 0
      ? baselineTokens * costPerToken
      : trailingDailyMetric(records, start, totalDays, 'cost'))

  return {
    period,
    label,
    startDate: dateKeyFromUsageDate(start),
    endDate: dateKeyFromUsageDate(end),
    elapsedDays,
    totalDays,
    observedTokens,
    observedCost,
    projectedTokens,
    projectedCost,
    baselineTokens,
    baselineCost,
    tokenChangePercent: percentChange(projectedTokens, baselineTokens),
    costChangePercent: percentChange(projectedCost, baselineCost),
    confidence: usageForecastConfidence(records, start, elapsedDays, totalDays, observedTokens),
  }
}

function buildUsageForecastAlerts(forecasts: UsageForecast[]): UsageForecastAlert[] {
  return forecasts
    .flatMap((forecast) => {
      const alerts: UsageForecastAlert[] = []
      const tokenDelta = forecast.tokenChangePercent
      const costDelta = forecast.costChangePercent
      const confidenceAllowsAlert =
        forecast.confidence !== 'low' || Math.max(tokenDelta ?? 0, costDelta ?? 0) >= 100

      if (!confidenceAllowsAlert) return alerts

      if (
        tokenDelta !== null &&
        tokenDelta >= 35 &&
        forecast.projectedTokens - forecast.baselineTokens >= 1_000
      ) {
        alerts.push({
          id: `${forecast.period}-tokens`,
          period: forecast.period,
          metric: 'tokens',
          severity: tokenDelta >= 100 ? 'critical' : 'warning',
          deltaPercent: tokenDelta,
          projectedValue: forecast.projectedTokens,
          baselineValue: forecast.baselineTokens,
        })
      }

      if (
        costDelta !== null &&
        costDelta >= 35 &&
        forecast.projectedCost - forecast.baselineCost >= 0.01
      ) {
        alerts.push({
          id: `${forecast.period}-cost`,
          period: forecast.period,
          metric: 'cost',
          severity: costDelta >= 100 ? 'critical' : 'warning',
          deltaPercent: costDelta,
          projectedValue: forecast.projectedCost,
          baselineValue: forecast.baselineCost,
        })
      }

      return alerts
    })
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
      return b.deltaPercent - a.deltaPercent
    })
}

function buildUsageForecasts(
  usage: UsagePoint[],
  costByDate: Map<string, number>,
  generatedAt: string,
): UsageForecasts {
  const records = dailyRecordsFromUsage(usage, costByDate)
  const latestDate = latestUsageRecordDate(records, generatedAt)
  const costPerToken = historicalCostPerToken(records)
  const week = buildPeriodForecast('week', 'This week', latestDate, records, costPerToken)
  const month = buildPeriodForecast('month', 'This month', latestDate, records, costPerToken)

  return {
    week,
    month,
    alerts: buildUsageForecastAlerts([week, month]),
  }
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

export function usageSparklineTrend(
  usage: UsagePoint[],
  key: AgentSource | 'total' = 'total',
): number[] {
  return usage.slice(-12).map((point) => point[key])
}

export function createSparklinePath(values: number[], width = 96, height = 32): string {
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

export type UsageHeatmapRow = {
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

export function buildUsageAnalytics(snapshot: DashboardSnapshot, range: UsagePageRange) {
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
  const forecast = buildUsageForecasts(snapshot.usage, allCostByDate, snapshot.generatedAt)
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
    forecast,
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

export function exportUsageCsv(snapshot: DashboardSnapshot, range: UsagePageRange): void {
  const analytics = buildUsageAnalytics(snapshot, range)
  downloadCsv(`clean-my-agent-usage-${range}.csv`, [
    ['Range', usagePageRangeLabel(range)],
    ['Total Tokens', String(Math.round(analytics.summary.totalTokens))],
    ['Known or Model-Priced Cost USD', analytics.summary.estimatedCost.toFixed(4)],
    ['Pricing Coverage', `${analytics.summary.costCoverage.toFixed(1)}%`],
    ['Active Sessions', String(analytics.summary.activeSessions)],
    ['Avg Tokens Per Day', String(Math.round(analytics.summary.avgTokensPerDay))],
    ['This Week Projected Tokens', String(Math.round(analytics.forecast.week.projectedTokens))],
    ['This Week Projected Cost USD', analytics.forecast.week.projectedCost.toFixed(4)],
    ['This Month Projected Tokens', String(Math.round(analytics.forecast.month.projectedTokens))],
    ['This Month Projected Cost USD', analytics.forecast.month.projectedCost.toFixed(4)],
    [
      'Forecast Alerts',
      analytics.forecast.alerts.length
        ? analytics.forecast.alerts
            .map((alert) => `${alert.period} ${alert.metric} +${alert.deltaPercent.toFixed(1)}%`)
            .join('; ')
        : 'None',
    ],
    [],
    ['Date', ...agentSources.map((source) => agentLabel[source]), 'Total'],
    ...analytics.selectedUsage.map((point) => [
      point.date,
      ...agentSources.map((source) => String(point[source])),
      String(point.total),
    ]),
  ])
}
