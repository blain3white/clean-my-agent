import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentSources,
  type AgentSource,
  type DashboardSnapshot,
  type SessionRecord,
} from '@/shared/types'
import {
  buildUsageAnalytics,
  buildUsageReport,
  costForTokenShare,
  createSparklinePath,
  exportUsageCsv,
  exportUsageReportMarkdown,
  formatHourLabel,
  formatHourRange,
  formatShortDate,
  formatUsageShare,
  formatUsageTimezoneLabel,
  formatUsageTokens,
  heatLevel,
  resolveUsageTimezone,
  usageReportMarkdown,
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

  it('formats usage timezone labels with the current offset', () => {
    const date = new Date('2026-06-09T12:00:00.000Z')

    expect(formatUsageTimezoneLabel('Asia/Shanghai', date)).toBe('Asia/Shanghai (UTC+8)')
    expect(formatUsageTimezoneLabel('America/Los_Angeles', date)).toBe(
      'America/Los_Angeles (UTC-7)',
    )
  })

  it('resolves local usage timezone settings before display and analytics', () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const label = formatUsageTimezoneLabel('local', new Date('2026-06-09T12:00:00.000Z'))

    expect(resolveUsageTimezone('local')).toBe(timezone)
    expect(label).toContain(`Local time (${timezone}, `)
    expect(label).toContain('UTC')
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

  it('uses usage event timestamps for project analytics in the configured timezone', () => {
    const usage = [usagePoint('2026-06-09', { codex: 450 })]
    const snapshot = makeSnapshot(usage, [
      makeSession({
        lastUpdated: '2026-06-08T18:30:00.000Z',
        tokens: {
          input: 100,
          output: 100,
          cached: 250,
          total: 450,
          costUsd: 9,
          estimated: false,
        },
        metadata: {
          usageByDate: { '2026-06-08': 450 },
          usageEvents: [{ timestamp: '2026-06-08T18:30:00.000Z', tokens: 450 }],
        },
      }),
    ])

    const analytics = buildUsageAnalytics(snapshot, '7d', 'Asia/Shanghai')

    expect(analytics.summary.activeSessions).toBe(1)
    expect(analytics.summary.estimatedCost).toBeCloseTo(9)
    expect(analytics.projectRows.find((row) => row.project === 'clean-my-agent')).toMatchObject({
      tokens: 450,
      cost: 9,
    })
  })

  it('uses configured timezone hours for heatmap sessions and peak windows', () => {
    const usage = [usagePoint('2026-06-09', { codex: 450 })]
    const snapshot = makeSnapshot(usage, [
      makeSession({
        lastUpdated: '2026-06-08T18:30:00.000Z',
        tokens: {
          input: 100,
          output: 100,
          cached: 250,
          total: 450,
          costUsd: 9,
          estimated: false,
        },
        metadata: {
          usageEvents: [{ timestamp: '2026-06-08T18:30:00.000Z', tokens: 450 }],
        },
      }),
    ])

    const analytics = buildUsageAnalytics(snapshot, '7d', 'Asia/Shanghai')
    const observedCell = analytics.heatmap.cells.find(
      (cell) => cell.date === '2026-06-09' && cell.hour === 2,
    )

    expect(observedCell).toMatchObject({ sessions: 1 })
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

describe('buildUsageReport', () => {
  it('summarizes projects, files, commands, and sensitive metadata for the selected range', () => {
    const usage = [
      usagePoint('2026-05-31', { codex: 50 }),
      usagePoint('2026-06-01', { codex: 250 }),
      usagePoint('2026-06-02', { codex: 750 }),
    ]
    const snapshot = makeSnapshot(usage, [
      makeSession({
        id: 'report-session',
        projectName: 'clean-my-agent',
        projectPath: '/repo/clean-my-agent',
        lastUpdated: '2026-06-02T10:00:00.000Z',
        tokens: {
          input: 400,
          output: 300,
          cached: 200,
          total: 1000,
          costUsd: 12,
          estimated: false,
        },
        metadata: {
          usageByDate: {
            '2026-06-01': 250,
            '2026-06-02': 750,
          },
          relayFiles: [
            {
              path: '/repo/clean-my-agent/src/App.tsx',
              reason: 'Referenced by filePath',
              lastSeenAt: '2026-06-02T09:00:00.000Z',
            },
            {
              path: '/repo/clean-my-agent/.env.local',
              reason: 'Sensitive file',
              lastSeenAt: '2026-06-02T09:00:00.000Z',
            },
          ],
          relayCommands: [
            {
              command: 'OPENAI_API_KEY=sk-test pnpm test -- --token secret-value',
              cwd: '/repo/clean-my-agent',
              createdAt: '2026-06-02T09:30:00.000Z',
            },
          ],
          gitChangedFiles: ['src/features/usage/UsageView.tsx', '.env'],
        },
      }),
      makeSession({
        id: 'old-report-session',
        projectName: 'old-project',
        projectPath: '/repo/old-project',
        lastUpdated: '2026-05-01T10:00:00.000Z',
        tokens: {
          input: 50,
          output: 25,
          cached: 0,
          total: 75,
          costUsd: 1,
          estimated: false,
        },
        metadata: {
          usageByDate: {
            '2026-05-01': 75,
          },
          relayFiles: [{ path: '/repo/old-project/src/old.ts' }],
        },
      }),
    ])

    const report = buildUsageReport(snapshot, '7d')

    expect(report.summary).toMatchObject({
      totalTokens: 1000,
      estimatedCost: 12,
      activeSessions: 1,
      projectCount: 1,
      fileCount: 2,
      commandCount: 1,
    })
    expect(report.projects[0]).toMatchObject({
      project: 'clean-my-agent',
      tokens: 1000,
      fileCount: 2,
      commandCount: 1,
    })
    expect(report.files.map((file) => file.path)).toEqual([
      'src/features/usage/UsageView.tsx',
      'src/App.tsx',
    ])
    expect(report.files.every((file) => !file.path.includes('.env'))).toBe(true)
    expect(report.commands[0].command).toBe(
      'OPENAI_API_KEY=[redacted] pnpm test -- --token [redacted]',
    )
    expect(report.highlights.join('\n')).toContain('clean-my-agent led')
  })

  it('uses the configured timezone when building project reports', () => {
    const usage = [usagePoint('2026-06-09', { codex: 450 })]
    const snapshot = makeSnapshot(usage, [
      makeSession({
        lastUpdated: '2026-06-08T18:30:00.000Z',
        tokens: {
          input: 100,
          output: 100,
          cached: 250,
          total: 450,
          costUsd: 9,
          estimated: false,
        },
        metadata: {
          usageByDate: { '2026-06-08': 450 },
          usageEvents: [{ timestamp: '2026-06-08T18:30:00.000Z', tokens: 450 }],
          relayFiles: [
            { path: '/repo/clean-my-agent/src/report.ts', lastSeenAt: '2026-06-08T18:30:00.000Z' },
            {
              path: '/repo/clean-my-agent/src/stale.ts',
              lastSeenAt: '2026-06-07T18:30:00.000Z',
            },
          ],
          relayCommands: [
            { command: 'pnpm check', createdAt: '2026-06-08T18:30:00.000Z' },
            { command: 'pnpm stale', createdAt: '2026-06-07T18:30:00.000Z' },
          ],
        },
      }),
    ])

    const report = buildUsageReport(snapshot, '7d', 'Asia/Shanghai')

    expect(report.summary).toMatchObject({
      totalTokens: 450,
      estimatedCost: 9,
      activeSessions: 1,
      fileCount: 1,
      commandCount: 1,
    })
    expect(report.projects[0]).toMatchObject({
      project: 'clean-my-agent',
      tokens: 450,
      cost: 9,
    })
    expect(report.files.map((file) => file.path)).toEqual(['src/report.ts'])
    expect(report.commands.map((command) => command.command)).toEqual(['pnpm check'])
  })

  it('renders markdown report sections', () => {
    const report = buildUsageReport(
      makeSnapshot(
        [usagePoint('2026-06-06', { codex: 123 })],
        [
          makeSession({
            metadata: {
              usageByDate: { '2026-06-06': 123 },
              gitChangedFiles: ['src/report.ts'],
            },
            tokens: { input: 50, output: 73, cached: 0, total: 123, estimated: false },
          }),
        ],
      ),
      '7d',
    )

    expect(report.projects[0].topFiles).toEqual(['src/report.ts'])
  })

  it('renders markdown with top files, file rows, command rows, and empty fallbacks', () => {
    const markdown = usageReportMarkdown({
      generatedAt: '2026-06-06T16:00:00.000Z',
      range: '7d',
      rangeLabel: '7D',
      startDate: '2026-06-01',
      endDate: '2026-06-06',
      summary: {
        totalTokens: 1234,
        estimatedCost: 0.42,
        activeSessions: 2,
        projectCount: 1,
        fileCount: 2,
        commandCount: 2,
      },
      highlights: ['1.2K tokens across 2 sessions'],
      projects: [
        {
          project: 'clean-my-agent',
          projectPath: '/repo/clean-my-agent',
          tokens: 1234,
          cost: 0.42,
          share: 100,
          sessionCount: 2,
          fileCount: 2,
          commandCount: 2,
          topFiles: ['src/App.tsx'],
        },
      ],
      files: [
        {
          path: 'src/App.tsx',
          projects: ['clean-my-agent'],
          sessions: 2,
          reason: 'Changed in git diff',
          changed: true,
        },
        {
          path: 'src/usage.ts',
          projects: ['clean-my-agent'],
          sessions: 1,
          reason: 'Referenced in session',
          changed: false,
        },
      ],
      commands: [
        { command: 'pnpm check', cwd: '/repo/clean-my-agent', sessions: 2 },
        { command: 'pnpm lint', sessions: 1 },
      ],
    })

    expect(markdown).toContain('Top files:')
    expect(markdown).toContain('- [changed] src/App.tsx')
    expect(markdown).toContain('- [referenced] src/usage.ts')
    expect(markdown).toContain('pnpm check (cwd: /repo/clean-my-agent) · 2 sessions')
    expect(markdown).toContain('pnpm lint · 1 session')

    const emptyMarkdown = usageReportMarkdown({
      generatedAt: '2026-06-06T16:00:00.000Z',
      range: 'all',
      rangeLabel: 'All',
      summary: {
        totalTokens: 0,
        estimatedCost: 0,
        activeSessions: 0,
        projectCount: 0,
        fileCount: 0,
        commandCount: 0,
      },
      highlights: ['No token activity in this range'],
      projects: [],
      files: [],
      commands: [],
    })

    expect(emptyMarkdown).toContain('Range: All (All time)')
    expect(emptyMarkdown).toContain('- No file metadata detected.')
    expect(emptyMarkdown).toContain('- No command metadata detected.')
  })

  it('handles all-time report metadata fallbacks and sorting tie-breakers', () => {
    const snapshot = makeSnapshot(
      [usagePoint('2026-06-01', { codex: 100 }), usagePoint('2026-06-02', { cursor: 200 })],
      [
        makeSession({
          id: 'alpha-session',
          projectName: 'Alpha',
          projectPath: '/repo/alpha',
          lastUpdated: '2026-06-01T10:00:00.000Z',
          tokens: { input: 100, output: 0, cached: 0, total: 100, costUsd: 1, estimated: false },
          metadata: {
            relayFiles: [
              { path: 'src/a.ts', reason: 'Read file' },
              { path: 'src/b.ts', reason: 'Edited file' },
              { path: '' },
              'not-a-record',
              { path: '/repo/alpha/.ssh/id_rsa' },
            ],
            relayCommands: [
              { command: 'pnpm test', cwd: '/repo/alpha', createdAt: '2026-06-01T08:00:00.000Z' },
              { command: 'pnpm test', cwd: '/repo/alpha', createdAt: '2026-06-01T09:00:00.000Z' },
              { command: 'pnpm lint', cwd: '/repo/alpha', createdAt: '2026-06-01T09:00:00.000Z' },
              { command: '' },
            ],
            gitChangedFiles: ['src/b.ts', '', 'api-key.txt'],
          },
        }),
        makeSession({
          id: 'beta-session',
          source: 'cursor',
          projectName: 'Beta',
          projectPath: '/repo/beta',
          lastUpdated: '2026-06-02T10:00:00.000Z',
          tokens: { input: 100, output: 0, cached: 0, total: 100, costUsd: 2, estimated: false },
          metadata: {
            relayFiles: [{ path: './src/beta.ts', lastSeenAt: 'not-a-date' }],
            relayCommands: [{ command: 'pnpm build' }],
            gitChangedFiles: ['../shared.ts'],
          },
        }),
        makeSession({
          id: 'unknown-session',
          source: 'gemini',
          projectName: '',
          projectPath: undefined,
          lastUpdated: '2026-06-02T11:00:00.000Z',
          tokens: { input: 100, output: 0, cached: 0, total: 100, costUsd: 2, estimated: false },
          metadata: {
            relayFiles: [{ path: 'notes.md' }],
            relayCommands: [{ command: 'pnpm typecheck', createdAt: '2026-06-02T11:00:00.000Z' }],
            gitChangedFiles: ['credentials.json'],
          },
        }),
      ],
    )

    const report = buildUsageReport(snapshot, 'all')

    expect(report.summary).toMatchObject({
      totalTokens: 300,
      estimatedCost: 5,
      activeSessions: 3,
      projectCount: 3,
      commandCount: 4,
    })
    expect(report.projects.map((project) => project.project)).toEqual([
      'Beta',
      'Unknown project',
      'Alpha',
    ])
    expect(report.files.map((file) => file.path)).toEqual([
      '../shared.ts',
      'src/b.ts',
      './src/beta.ts',
      'notes.md',
      'src/a.ts',
    ])
    expect(report.files.every((file) => !/ssh|api-key|credential/i.test(file.path))).toBe(true)
    expect(report.commands.map((command) => command.command)).toEqual([
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
    ])
    expect(report.commands.find((command) => command.command === 'pnpm test')).toMatchObject({
      command: 'pnpm test',
      lastRunAt: '2026-06-01T09:00:00.000Z',
      sessions: 1,
    })
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

  it('includes forecast alert rows when usage is rising quickly', () => {
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
    const totalTokens = usage.reduce((total, point) => total + point.total, 0)

    exportUsageCsv(
      makeSnapshot(usage, [
        makeSession({
          lastUpdated: '2026-06-10T12:00:00.000Z',
          tokens: {
            input: 0,
            output: 0,
            cached: 0,
            total: totalTokens,
            costUsd: totalTokens * 0.00002,
            estimated: false,
          },
          metadata: {
            usageByDate: Object.fromEntries(usage.map((point) => [point.date, point.total])),
          },
        }),
      ]),
      '30d',
    )

    const csv = (createObjectURL.mock.calls[0][0] as FakeBlob).chunks.join('')
    expect(csv).toContain('Forecast Alerts,')
    expect(csv).toContain('week tokens +200.0%')
  })
})

describe('exportUsageReportMarkdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads a markdown project report', () => {
    class FakeBlob {
      chunks: string[]
      constructor(chunks: string[]) {
        this.chunks = chunks
      }
    }
    const anchor = { href: '', download: '', click: vi.fn() }
    const createObjectURL = vi.fn(() => 'blob:report')
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('Blob', FakeBlob)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
    })

    exportUsageReportMarkdown(
      makeSnapshot(
        [usagePoint('2026-06-06', { codex: 123 })],
        [
          makeSession({
            metadata: {
              usageByDate: { '2026-06-06': 123 },
              relayCommands: [{ command: 'pnpm check', cwd: '/repo/clean-my-agent' }],
            },
            tokens: { input: 50, output: 73, cached: 0, total: 123, estimated: false },
          }),
        ],
      ),
      '7d',
    )

    expect(anchor.download).toBe('clean-my-agent-report-7d.md')
    expect(anchor.href).toBe('blob:report')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    const markdown = (createObjectURL.mock.calls[0][0] as FakeBlob).chunks.join('')
    expect(markdown).toContain('# AI Weekly / Project Report')
    expect(markdown).toContain('pnpm check')
  })
})
