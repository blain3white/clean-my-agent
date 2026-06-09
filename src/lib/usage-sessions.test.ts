import { describe, expect, it } from 'vitest'
import type { SessionRecord, TokenUsage } from '@/shared/types'
import { sessionDateTokenEntries, sessionTokenTotalForDates } from './usage-sessions'

const baseTokens: TokenUsage = {
  input: 0,
  output: 0,
  cached: 0,
  total: 1000,
  estimated: false,
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    source: 'codex',
    title: 'Test session',
    projectName: 'clean-my-agent',
    storagePath: '/tmp/session.jsonl',
    storageKind: 'file',
    storageState: 'live',
    lastUpdated: '2026-06-06T10:30:00.000Z',
    messageCount: 1,
    tokens: baseTokens,
    sizeBytes: 100,
    backupStatus: 'unknown',
    tags: [],
    metadata: {},
    ...overrides,
  }
}

describe('sessionDateTokenEntries', () => {
  it('uses usageEvents in the selected timezone before legacy usageByDate', () => {
    expect(
      sessionDateTokenEntries(
        makeSession({
          metadata: {
            usageByDate: { '2026-06-08': 400 },
            usageEvents: [{ timestamp: '2026-06-08T18:30:00.000Z', tokens: 450 }],
          },
        }),
        'Asia/Shanghai',
      ),
    ).toEqual([['2026-06-09', 450]])
  })

  it('uses positive usageByDate entries when present', () => {
    expect(
      sessionDateTokenEntries(
        makeSession({
          metadata: {
            usageByDate: {
              '2026-06-01': 300,
              '2026-06-02': 700,
            },
          },
        }),
      ),
    ).toEqual([
      ['2026-06-01', 300],
      ['2026-06-02', 700],
    ])
  })

  it('filters non-positive and non-finite usageByDate values', () => {
    expect(
      sessionDateTokenEntries(
        makeSession({
          metadata: {
            usageByDate: {
              '2026-06-01': 0,
              '2026-06-02': -5,
              '2026-06-03': Number.POSITIVE_INFINITY,
              '2026-06-04': 250,
            },
          },
        }),
      ),
    ).toEqual([['2026-06-04', 250]])
  })

  it('falls back to lastUpdated date and total tokens when usageByDate is missing or empty', () => {
    expect(sessionDateTokenEntries(makeSession())).toEqual([['2026-06-06', 1000]])
    expect(sessionDateTokenEntries(makeSession({ metadata: { usageByDate: {} } }))).toEqual([
      ['2026-06-06', 1000],
    ])
    expect(
      sessionDateTokenEntries(
        makeSession({ lastUpdated: '2026-06-08T18:30:00.000Z' }),
        'Asia/Shanghai',
      ),
    ).toEqual([['2026-06-09', 1000]])
  })

  it('falls back when usageByDate is not a plain object', () => {
    expect(
      sessionDateTokenEntries(
        makeSession({
          tokens: { ...baseTokens, total: 200 },
          metadata: { usageByDate: [100, 100] },
        }),
      ),
    ).toEqual([['2026-06-06', 200]])
  })
})

describe('sessionTokenTotalForDates', () => {
  it('sums only entries whose dates are selected', () => {
    const sessions = [
      makeSession({
        metadata: { usageByDate: { '2026-06-01': 400, '2026-06-02': 600 } },
      }),
      makeSession({
        id: 'session-2',
        lastUpdated: '2026-06-02T12:00:00.000Z',
        tokens: { ...baseTokens, total: 100 },
      }),
    ]

    expect(sessionTokenTotalForDates(sessions, new Set(['2026-06-02']))).toBe(700)
  })

  it('sums usage events in the selected timezone', () => {
    const sessions = [
      makeSession({
        metadata: {
          usageByDate: { '2026-06-08': 450 },
          usageEvents: [{ timestamp: '2026-06-08T18:30:00.000Z', tokens: 450 }],
        },
      }),
    ]

    expect(sessionTokenTotalForDates(sessions, new Set(['2026-06-09']), 'Asia/Shanghai')).toBe(450)
  })

  it('returns zero when no dates match', () => {
    expect(
      sessionTokenTotalForDates(
        [makeSession({ metadata: { usageByDate: { '2026-06-01': 500 } } })],
        new Set(['2026-06-09']),
      ),
    ).toBe(0)
  })
})
