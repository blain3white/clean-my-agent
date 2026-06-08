import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentSources,
  type AgentSource,
  type DashboardSnapshot,
  type SessionRecord,
} from '@/shared/types'
import {
  buildUsageAnalytics,
  costForTokenShare,
  createSparklinePath,
  exportUsageCsv,
  formatHourLabel,
  formatHourRange,
  formatShortDate,
  formatUsageShare,
  formatUsageTokens,
  heatLevel,
  usageDaysForPageRange,
  usageSparklineTrend,
} from './usage-analytics'

function usagePoint(date: string, values: Partial<Record<AgentSource, number>> = {}) {
  const codex = values.codex ?? 0
  const claude = values.claude ?? 0
  const cursor = values.cursor ?? 0
  const gemini = values.gemini ?? 0
  const opencode = values.opencode ?? 0
  const custom = values.custom ?? 0
  return {
    date,
    codex,
    claude,
    cursor,
    gemini,
    opencode,
    custom,
    total: codex + claude + cursor + gemini + opencode + custom,
  }
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    source: 'codex',
    title: 'Usage session',
    projectName: 'clean-my-agent',
    projectPath: '/repo/clean-my-agent',
    storagePath: '/tmp/session.jsonl',
    storageKind: 'file',
    storageState: 'live',
    lastUpdated: '2026-06-06T15:30:00.000Z',
    messageCount: 1,
    tokens: {
      input: 400,
      output: 300,
      cached: 200,
      total: 1000,
      costUsd: 10,
      estimated: false,
    },
    sizeBytes: 100,
    backupStatus: 'unknown',
    tags: [],
    metadata: {
      usageByDate: {
        '2026-06-05': 600,
        '2026-06-06': 400,
      },
    },
    ...overrides,
  }
}

function makeSnapshot(
  usage: DashboardSnapshot['usage'],
  sessions: SessionRecord[],
): DashboardSnapshot {
  return {
    generatedAt: '2026-06-06T16:00:00.000Z',
    overview: {
      totalSessions: sessions.length,
      backedUpSessions: 0,
      reclaimableBytes: 0,
      totalTokens: usage.reduce((total, point) => total + point.total, 0),
      totalSizeBytes: 0,
      highRiskCleanupCount: 0,
    },
    agents: agentSources.map((source) => ({
      source,
      name: source === 'claude' ? 'Claude Code' : source,
      installed: true,
      readable: true,
      rootPaths: [],
      sessionCount: sessions.filter((session) => session.source === source).length,
      sizeBytes: 0,
    })),
    sessions,
    cleanup: [],
    archives: [],
    backups: [],
    trash: [],
    usage,
    storage: [],
  }
}

describe('usage formatting helpers', () => {
  it.each([
    [-5, '0'],
    [999, '999'],
    [1000, '1.0K'],
    [1_500_000, '1.5M'],
    [2_000_000_000, '2.00B'],
  ])('formats %d tokens as %s', (tokens, expected) => {
    expect(formatUsageTokens(tokens)).toBe(expected)
  })

  it('formats share and hour labels', () => {
    expect(formatUsageShare(33.333)).toBe('33.3%')
    expect(formatHourLabel(0)).toBe('12 AM')
    expect(formatHourLabel(12)).toBe('12 PM')
    expect(formatHourLabel(25)).toBe('1 AM')
    expect(formatHourRange(15, 16)).toBe('3 PM - 4 PM')
  })

  it('formats short dates with a raw fallback for invalid dates', () => {
    expect(formatShortDate('2026-06-06')).toBe('Jun 06')
    expect(formatShortDate('not-a-date')).toBe('-date')
  })
})

describe('usage math helpers', () => {
  it('maps values to heat levels with zero and upper guards', () => {
    expect(heatLevel(1, 0)).toBe(0)
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(50, 100)).toBe(5)
    expect(heatLevel(200, 100)).toBe(9)
  })

  it('allocates cost by token share only for positive inputs', () => {
    expect(costForTokenShare(500, 1000, 10)).toBeCloseTo(5)
    expect(costForTokenShare(0, 1000, 10)).toBe(0)
    expect(costForTokenShare(500, 0, 10)).toBe(0)
    expect(costForTokenShare(500, 1000, 0)).toBe(0)
  })

  it('creates sparkline paths for empty, single, flat, and changing values', () => {
    expect(createSparklinePath([])).toBe('')
    expect(createSparklinePath([42], 96, 32)).toBe('M 96.0 30.0')
    expect(createSparklinePath([5, 5, 5])).toBe('M 0.0 30.0 L 48.0 30.0 L 96.0 30.0')
    expect(createSparklinePath([0, 50, 100], 100, 32)).toMatch(/^M 0\.0 30\.0 L 50\.0/)
  })

  it('uses the selected range for usage days and sparkline values', () => {
    const usage = Array.from({ length: 15 }, (_, index) =>
      usagePoint(`2026-06-${String(index + 1).padStart(2, '0')}`, {
        codex: index,
        claude: index * 2,
      }),
    )

    expect(usageDaysForPageRange([], 'all')).toBe(365)
    expect(usageDaysForPageRange(usage, 'all')).toBe(15)
    expect(usageDaysForPageRange(usage, '7d')).toBe(7)
    expect(usageSparklineTrend(usage)).toEqual(usage.slice(-12).map((point) => point.total))
    expect(usageSparklineTrend(usage, 'claude')).toEqual(
      usage.slice(-12).map((point) => point.claude),
    )
  })
})

describe('buildUsageAnalytics', () => {
  it('builds range analytics with cost attribution, heatmap rows, agents, and projects', () => {
    const usage = Array.from({ length: 14 }, (_, index) =>
      usagePoint(`2026-05-${String(24 + index).padStart(2, '0')}`, {
        codex: 100 + index,
        claude: 50,
      }),
    )
    usage[12] = usagePoint('2026-06-05', { codex: 600, claude: 100 })
    usage[13] = usagePoint('2026-06-06', { codex: 400, claude: 200 })
    const snapshot = makeSnapshot(usage, [
      makeSession(),
      makeSession({
        id: 'session-2',
        source: 'claude',
        projectName: 'old-project',
        projectPath: '/repo/old-project',
        lastUpdated: '2026-05-25T09:00:00.000Z',
        tokens: {
          input: 80,
          output: 20,
          cached: 0,
          total: 100,
          costUsd: 5,
          estimated: false,
        },
        metadata: { usageByDate: { '2026-05-25': 100 } },
      }),
    ])

    const analytics = buildUsageAnalytics(snapshot, '7d')

    expect(analytics.selectedUsage).toHaveLength(7)
    expect(analytics.summary.totalTokens).toBe(
      analytics.selectedUsage.reduce((total, point) => total + point.total, 0),
    )
    expect(analytics.summary.estimatedCost).toBeCloseTo(10)
    expect(analytics.summary.activeSessions).toBe(1)
    expect(analytics.summary.costCoverage).toBeGreaterThan(0)
    expect(analytics.heatmap.rows).toHaveLength(7)
    expect(analytics.heatmap.cells).toHaveLength(7 * 24)
    expect(analytics.peakWindows).toHaveLength(8)
    expect(analytics.agentRows.find((row) => row.source === 'codex')?.cost).toBeCloseTo(10)
    expect(analytics.projectRows.find((row) => row.project === 'clean-my-agent')).toMatchObject({
      tokens: 1000,
    })
    expect(analytics.trends.totalTokens).toContain('vs prior period')
  })

  it('forecasts current week and month usage and flags abnormal increases', () => {
    const mayUsage = Array.from({ length: 31 }, (_, index) =>
      usagePoint(`2026-05-${String(index + 1).padStart(2, '0')}`, { codex: 1_000 }),
    )
    const priorWeek = Array.from({ length: 7 }, (_, index) =>
      usagePoint(`2026-06-${String(index + 1).padStart(2, '0')}`, { codex: 1_000 }),
    )
    const currentWeek = [8, 9, 10].map((day) =>
      usagePoint(`2026-06-${String(day).padStart(2, '0')}`, { codex: 3_000 }),
    )
    const usage = [...mayUsage, ...priorWeek, ...currentWeek]
    const usageByDate = Object.fromEntries(usage.map((point) => [point.date, point.total]))
    const totalTokens = usage.reduce((total, point) => total + point.total, 0)
    const snapshot = makeSnapshot(usage, [
      makeSession({
        id: 'priced-history',
        lastUpdated: '2026-06-10T12:00:00.000Z',
        tokens: {
          input: 0,
          output: 0,
          cached: 0,
          total: totalTokens,
          costUsd: totalTokens * 0.00002,
          estimated: false,
        },
        metadata: { usageByDate },
      }),
    ])

    const analytics = buildUsageAnalytics(snapshot, '30d')

    expect(analytics.forecast.week).toMatchObject({
      startDate: '2026-06-08',
      endDate: '2026-06-14',
      elapsedDays: 3,
      totalDays: 7,
      confidence: 'medium',
    })
    expect(analytics.forecast.week.projectedTokens).toBeCloseTo(21_000)
    expect(analytics.forecast.week.projectedCost).toBeCloseTo(0.42)
    expect(analytics.forecast.week.tokenChangePercent).toBeCloseTo(200)
    expect(analytics.forecast.month).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      elapsedDays: 10,
      totalDays: 30,
    })
    expect(analytics.forecast.month.projectedTokens).toBeCloseTo(48_000)
    expect(analytics.forecast.alerts.map((alert) => alert.id)).toEqual(
      expect.arrayContaining(['week-tokens', 'week-cost', 'month-tokens', 'month-cost']),
    )
  })

  it('groups longer ranges into weekly heatmap rows and keeps session metadata fallback', () => {
    const usage = Array.from({ length: 30 }, (_, index) =>
      usagePoint(`2026-05-${String(index + 1).padStart(2, '0')}`, {
        codex: index === 29 ? 0 : 10,
      }),
    )
    const snapshot = makeSnapshot(usage, [
      makeSession({
        id: 'no-usage-session',
        source: 'cursor',
        projectName: 'metadata-only',
        projectPath: undefined,
        lastUpdated: '2026-05-30T08:00:00.000Z',
        tokens: {
          input: 10,
          output: 5,
          cached: 0,
          total: 15,
          estimated: false,
        },
        metadata: {},
      }),
    ])

    const analytics = buildUsageAnalytics(snapshot, '30d')

    expect(analytics.heatmap.rows).toHaveLength(5)
    expect(analytics.heatmap.rows[0]).toMatchObject({
      key: '2026-05-01:2026-05-07',
      dateKeys: [
        '2026-05-01',
        '2026-05-02',
        '2026-05-03',
        '2026-05-04',
        '2026-05-05',
        '2026-05-06',
        '2026-05-07',
      ],
    })
    expect(analytics.agentRows.find((row) => row.source === 'cursor')).toMatchObject({
      tokens: 15,
      hasTokenMetadata: true,
    })
  })

  it('marks agent rows with no token metadata when usage and sessions are empty', () => {
    const analytics = buildUsageAnalytics(makeSnapshot([], []), 'all')

    expect(analytics.agentRows.every((row) => row.tokens === 0)).toBe(true)
    expect(analytics.agentRows.every((row) => row.hasTokenMetadata === false)).toBe(true)
  })

  it('falls back to session totals for all-time analytics without usage points', () => {
    const analytics = buildUsageAnalytics(makeSnapshot([], [makeSession()]), 'all')

    expect(analytics.summary.totalTokens).toBe(1000)
    expect(analytics.summary.estimatedCost).toBe(10)
    expect(analytics.summary.activeSessions).toBe(1)
    expect(analytics.summary.avgTokensPerDay).toBeCloseTo(1000 / 365)
    expect(analytics.heatmap.rows).toEqual([])
    expect(analytics.summary.peakHour.tokens).toBe(0)
    expect(analytics.trends.totalTokens).toBe('+100.0% vs prior period')
  })
})

describe('exportUsageCsv', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads a CSV for the selected usage range', () => {
    class FakeBlob {
      chunks: string[]
      constructor(chunks: string[]) {
        this.chunks = chunks
      }
    }
    const anchor = { href: '', download: '', click: vi.fn() }
    const createObjectURL = vi.fn(() => 'blob:usage')
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('Blob', FakeBlob)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
    })

    exportUsageCsv(makeSnapshot([usagePoint('2026-06-06', { codex: 123 })], []), '7d')

    expect(anchor.download).toBe('clean-my-agent-usage-7d.csv')
    expect(anchor.href).toBe('blob:usage')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:usage')
    const blob = createObjectURL.mock.calls[0][0] as FakeBlob
    expect(blob.chunks.join('')).toContain('Total Tokens,123')
  })

  it('exports empty all-time ranges with zeroed summary rows', () => {
    class FakeBlob {
      chunks: string[]
      constructor(chunks: string[]) {
        this.chunks = chunks
      }
    }
    const createObjectURL = vi.fn(() => 'blob:usage')
    vi.stubGlobal('Blob', FakeBlob)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn() })),
    })

    exportUsageCsv(makeSnapshot([], []), 'all')

    const csv = (createObjectURL.mock.calls[0][0] as FakeBlob).chunks.join('')
    expect(csv).toContain('Range,All')
    expect(csv).toContain('Total Tokens,0')
    expect(csv).toContain('Pricing Coverage,0.0%')
    expect(csv).toContain('Forecast Alerts,None')
  })
})
