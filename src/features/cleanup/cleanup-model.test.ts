import { describe, expect, it } from 'vitest'
import type {
  AgentSource,
  CleanupCandidate,
  CleanupKind,
  SessionRecord,
  TokenUsage,
} from '@/shared/types'
import {
  buildCleanupCandidateGroups,
  buildCleanupCategorySummaries,
  cleanupCategoryForCandidate,
  cleanupCompactPath,
  defaultCleanupSelection,
} from './cleanup-model'

const baseTokens: TokenUsage = {
  input: 0,
  output: 0,
  cached: 0,
  total: 0,
  estimated: false,
}

function candidate(
  overrides: Partial<CleanupCandidate> & { id: string; kind: CleanupKind },
): CleanupCandidate {
  return {
    title: overrides.id,
    source: 'codex',
    sessionIds: [],
    paths: [],
    sizeBytes: 0,
    reason: 'test',
    risk: 'low',
    recoverable: true,
    backedUp: true,
    ...overrides,
  }
}

function session(
  overrides: Partial<SessionRecord> & { id: string; source?: AgentSource },
): SessionRecord {
  return {
    source: 'codex',
    title: overrides.id,
    projectName: 'clean-my-agent',
    storagePath: '/tmp/session.jsonl',
    storageKind: 'file',
    storageState: 'live',
    lastUpdated: '2026-06-06T12:00:00.000Z',
    messageCount: 1,
    tokens: baseTokens,
    sizeBytes: 100,
    backupStatus: 'unknown',
    tags: [],
    metadata: {},
    ...overrides,
  }
}

describe('cleanup categories', () => {
  it.each([
    ['old-session', 'inactive'],
    ['backed-up-session', 'inactive'],
    ['orphan-session', 'inactive'],
    ['large-log', 'large'],
    ['duplicate-backup', 'test'],
    ['temp-file', 'test'],
    ['invalid-cache', 'test'],
  ] as const)('maps %s candidates to %s', (kind, expected) => {
    expect(cleanupCategoryForCandidate(candidate({ id: kind, kind }))).toBe(expected)
  })

  it('selects inactive and test candidates by default while excluding large chats', () => {
    expect(
      defaultCleanupSelection([
        candidate({ id: 'old', kind: 'old-session' }),
        candidate({ id: 'large', kind: 'large-log' }),
        candidate({ id: 'temp', kind: 'temp-file' }),
      ]),
    ).toEqual(['old', 'temp'])
  })

  it('aggregates category summaries in a stable order', () => {
    const summaries = buildCleanupCategorySummaries([
      candidate({ id: 'large', kind: 'large-log', sizeBytes: 500 }),
      candidate({ id: 'old', kind: 'old-session', sizeBytes: 200 }),
      candidate({ id: 'temp', kind: 'temp-file', sizeBytes: 100 }),
      candidate({ id: 'duplicate', kind: 'duplicate-backup', sizeBytes: 50 }),
    ])

    expect(summaries.map((summary) => summary.key)).toEqual(['large', 'inactive', 'test'])
    expect(summaries.find((summary) => summary.key === 'large')).toMatchObject({
      bytes: 500,
      count: 1,
    })
    expect(summaries.find((summary) => summary.key === 'inactive')).toMatchObject({
      bytes: 200,
      count: 1,
    })
    expect(summaries.find((summary) => summary.key === 'test')).toMatchObject({
      bytes: 150,
      count: 2,
    })
  })

  it('returns zeroed summaries for empty input', () => {
    const summaries = buildCleanupCategorySummaries([])

    expect(summaries.map((summary) => summary.key)).toEqual(['large', 'inactive', 'test'])
    expect(summaries.every((summary) => summary.bytes === 0 && summary.count === 0)).toBe(true)
  })
})

describe('cleanup paths', () => {
  it('keeps compact paths unchanged when they fit', () => {
    expect(cleanupCompactPath('/short/path', 72)).toBe('/short/path')
  })

  it('compacts long paths while preserving both ends', () => {
    const value = '/Users/demo/projects/clean-my-agent/deeply/nested/session/file.jsonl'
    const compact = cleanupCompactPath(value, 34)

    expect(compact).toContain('...')
    expect(compact.length).toBeLessThan(value.length)
    expect(compact.startsWith(value.slice(0, 18))).toBe(true)
    expect(compact.endsWith(value.slice(-24))).toBe(true)
  })
})

describe('buildCleanupCandidateGroups', () => {
  it('groups candidates by source and session workspace', () => {
    const sessionById = new Map([
      [
        's1',
        session({
          id: 's1',
          source: 'claude',
          projectName: 'agent-lab',
          projectPath: '/Users/demo/agent-lab',
        }),
      ],
    ])
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'c1',
          kind: 'old-session',
          source: undefined,
          sessionIds: ['s1'],
          sizeBytes: 100,
        }),
        candidate({
          id: 'c2',
          kind: 'temp-file',
          source: undefined,
          sessionIds: ['s1'],
          sizeBytes: 200,
        }),
      ],
      sessionById,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 'claude:/Users/demo/agent-lab',
      source: 'claude',
      bytes: 300,
      workspace: {
        key: '/Users/demo/agent-lab',
        label: 'agent-lab',
      },
    })
    expect(groups[0].candidates.map((item) => item.id)).toEqual(['c1', 'c2'])
  })

  it('uses project-name-only session metadata when no project path is known', () => {
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'project-only',
          kind: 'old-session',
          source: undefined,
          sessionIds: ['s1'],
        }),
      ],
      new Map([
        [
          's1',
          session({
            id: 's1',
            source: 'opencode',
            projectName: 'loose-project',
            projectPath: undefined,
          }),
        ],
      ]),
    )

    expect(groups[0]).toMatchObject({
      id: 'opencode:project:loose-project',
      workspace: {
        key: 'project:loose-project',
        label: 'loose-project',
        detail: 'Project name only',
      },
    })
  })

  it('labels session workspaces from project paths when project names are missing', () => {
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'path-label',
          kind: 'old-session',
          source: undefined,
          sessionIds: ['s1'],
        }),
      ],
      new Map([
        [
          's1',
          session({
            id: 's1',
            projectName: '',
            projectPath: '/Users/demo/projects/path-only',
          }),
        ],
      ]),
    )

    expect(groups[0].workspace).toMatchObject({
      key: '/Users/demo/projects/path-only',
      label: 'projects/path-only',
    })
  })

  it('uses candidate paths when no matching session exists', () => {
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'path',
          kind: 'large-log',
          source: 'cursor',
          paths: ['C:\\Users\\demo\\project\\.cursor\\session.json'],
          sizeBytes: 50,
        }),
      ],
      new Map(),
    )

    expect(groups[0]).toMatchObject({
      id: 'cursor:C:/Users/demo/project/.cursor',
      workspace: {
        key: 'C:/Users/demo/project/.cursor',
        label: 'project/.cursor',
      },
    })
  })

  it('falls back to an unknown workspace when paths and sessions are absent', () => {
    expect(
      buildCleanupCandidateGroups(
        [candidate({ id: 'unknown', kind: 'invalid-cache', source: undefined })],
        new Map(),
      )[0],
    ).toMatchObject({
      id: 'codex:unknown',
      workspace: {
        key: 'unknown',
        label: 'Unknown workspace',
      },
    })
  })

  it('handles directory paths and blank paths when deriving workspaces', () => {
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'directory',
          kind: 'large-log',
          source: 'gemini',
          paths: ['/Users/demo/workspace/logs'],
          sizeBytes: 30,
        }),
        candidate({
          id: 'blank',
          kind: 'large-log',
          source: 'gemini',
          paths: [''],
          sizeBytes: 10,
        }),
        candidate({
          id: 'file-only',
          kind: 'large-log',
          source: 'gemini',
          paths: ['session.jsonl'],
          sizeBytes: 5,
        }),
      ],
      new Map(),
    )

    expect(groups.find((group) => group.id === 'gemini:/Users/demo/workspace/logs')).toBeDefined()
    expect(groups.find((group) => group.id === 'gemini:unknown')).toMatchObject({
      workspace: { detail: 'No local path available' },
    })
    expect(groups.find((group) => group.id === 'gemini:session.jsonl')).toMatchObject({
      workspace: {
        label: 'session.jsonl',
        detail: 'session.jsonl',
      },
    })
  })

  it('tracks latest opened time and sorts by source order then bytes', () => {
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'claude',
          kind: 'old-session',
          source: 'claude',
          paths: ['/work/claude/a.jsonl'],
          sizeBytes: 500,
        }),
        candidate({
          id: 'codex-small',
          kind: 'old-session',
          source: 'codex',
          paths: ['/work/codex-small/a.jsonl'],
          sizeBytes: 10,
          lastUpdated: 'not-a-date',
        }),
        candidate({
          id: 'codex-large-old',
          kind: 'old-session',
          source: 'codex',
          paths: ['/work/codex-large/a.jsonl'],
          sizeBytes: 20,
          lastUpdated: '2026-06-02T00:00:00.000Z',
        }),
        candidate({
          id: 'codex-large-new',
          kind: 'temp-file',
          source: 'codex',
          paths: ['/work/codex-large/b.jsonl'],
          sizeBytes: 80,
          lastUpdated: '2026-06-05T00:00:00.000Z',
        }),
      ],
      new Map(),
    )

    expect(groups.map((group) => group.id)).toEqual([
      'codex:/work/codex-large',
      'codex:/work/codex-small',
      'claude:/work/claude',
    ])
    expect(groups[0].bytes).toBe(100)
    expect(groups[0].latestOpened).toBe('2026-06-05T00:00:00.000Z')
  })

  it('uses the first matching session id when grouping candidates', () => {
    const groups = buildCleanupCandidateGroups(
      [
        candidate({
          id: 'multi-session',
          kind: 'old-session',
          source: undefined,
          sessionIds: ['missing', 's2'],
        }),
      ],
      new Map([
        [
          's2',
          session({
            id: 's2',
            source: 'cursor',
            projectName: 'second-session-project',
          }),
        ],
      ]),
    )

    expect(groups[0]).toMatchObject({
      id: 'cursor:project:second-session-project',
      source: 'cursor',
    })
  })

  it('sorts equal-size groups by workspace label', () => {
    expect(
      buildCleanupCandidateGroups(
        [
          candidate({
            id: 'zeta',
            kind: 'old-session',
            paths: ['/work/zeta/a.jsonl'],
            sizeBytes: 10,
          }),
          candidate({
            id: 'alpha',
            kind: 'old-session',
            paths: ['/work/alpha/a.jsonl'],
            sizeBytes: 10,
          }),
        ],
        new Map(),
      ).map((group) => group.workspace.label),
    ).toEqual(['work/alpha', 'work/zeta'])
  })
})
