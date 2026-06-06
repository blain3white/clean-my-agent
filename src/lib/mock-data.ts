import type { AgentSource, DashboardSnapshot, SessionRecord } from '@/shared/types'
import { calculateUsageModelCost } from '@/shared/usage-pricing'

const GB = 1024 ** 3
const MB = 1024 ** 2
const now = new Date()
const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()

const sessionBase: Array<{
  id: string
  source: AgentSource
  title: string
  projectName: string
  branch: string
  hoursAgo: number
  messages: number
  tokens: number
  sizeMb: number
  backedUp: boolean
  model?: string
}> = [
  {
    id: 'demo-codex-1',
    source: 'codex',
    title: 'Polish cleanup queue layout',
    projectName: 'clean-my-agent',
    branch: 'main',
    hoursAgo: 0.2,
    messages: 184,
    tokens: 482_000,
    sizeMb: 412,
    backedUp: true,
    model: 'gpt-5-codex',
  },
  {
    id: 'demo-claude-1',
    source: 'claude',
    title: 'Fix billing retention policy',
    projectName: 'acme/billing',
    branch: 'feature/retention',
    hoursAgo: 1.1,
    messages: 231,
    tokens: 612_000,
    sizeMb: 528,
    backedUp: true,
    model: 'claude-sonnet-4-5-20250929',
  },
  {
    id: 'demo-cursor-1',
    source: 'cursor',
    title: 'Add analytics events',
    projectName: 'acme/analytics',
    branch: 'main',
    hoursAgo: 3.4,
    messages: 92,
    tokens: 286_000,
    sizeMb: 196,
    backedUp: true,
  },
  {
    id: 'demo-gemini-1',
    source: 'gemini',
    title: 'Research storage adapters',
    projectName: 'agent-lab',
    branch: 'research/storage',
    hoursAgo: 6.8,
    messages: 119,
    tokens: 314_000,
    sizeMb: 154,
    backedUp: false,
    model: 'gemini-2.5-pro',
  },
  {
    id: 'demo-opencode-1',
    source: 'opencode',
    title: 'Prototype relay converter',
    projectName: 'relay-kit',
    branch: 'prototype',
    hoursAgo: 13.6,
    messages: 76,
    tokens: 228_000,
    sizeMb: 132,
    backedUp: true,
    model: 'gpt-4.1',
  },
  {
    id: 'demo-codex-2',
    source: 'codex',
    title: 'Design settings data toggle',
    projectName: 'clean-my-agent',
    branch: 'mock-data',
    hoursAgo: 20.5,
    messages: 156,
    tokens: 436_000,
    sizeMb: 324,
    backedUp: true,
    model: 'gpt-5.1-codex-mini',
  },
  {
    id: 'demo-claude-2',
    source: 'claude',
    title: 'Trace export edge cases',
    projectName: 'agent-archive',
    branch: 'main',
    hoursAgo: 34,
    messages: 208,
    tokens: 548_000,
    sizeMb: 468,
    backedUp: false,
    model: 'claude-opus-4-5-20251101',
  },
  {
    id: 'demo-cursor-2',
    source: 'cursor',
    title: 'Tune dashboard cards',
    projectName: 'ops-dashboard',
    branch: 'ui-pass',
    hoursAgo: 46,
    messages: 88,
    tokens: 242_000,
    sizeMb: 188,
    backedUp: true,
  },
]

const sessions: SessionRecord[] = sessionBase.map((session) => {
  const input = Math.round(session.tokens * 0.56)
  const output = Math.round(session.tokens * 0.28)
  const cacheCreation = Math.round(session.tokens * 0.07)
  const cacheRead = Math.round(session.tokens * 0.09)
  const costUsd = calculateUsageModelCost({
    model: session.model,
    input,
    output,
    cacheCreation,
    cacheRead,
  })

  return {
    id: session.id,
    source: session.source,
    title: session.title,
    projectName: session.projectName,
    projectPath: `/Users/demo/projects/${session.projectName}`,
    branch: session.branch,
    storagePath: `/demo/${session.source}/${session.id}.jsonl`,
    storageKind: 'file',
    storageState: session.id.endsWith('-2') ? 'archived' : 'live',
    createdAt: ago(session.hoursAgo + 72),
    lastUpdated: ago(session.hoursAgo),
    messageCount: session.messages,
    tokens: {
      input,
      output,
      cached: cacheCreation + cacheRead,
      cacheCreation,
      cacheRead,
      total: session.tokens,
      ...(costUsd === undefined
        ? {}
        : { costUsd, costSource: 'model-estimate' as const, model: session.model }),
      estimated: session.source === 'cursor',
    },
    sizeBytes: session.sizeMb * MB,
    backupStatus: session.backedUp ? 'backed-up' : 'pending',
    tags: [session.source, 'demo'],
    searchText: `${session.title} ${session.projectName} ${session.branch} demo session archive cleanup token search`,
    metadata: {},
  }
})

const usage = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(now.getTime() - (29 - index) * 24 * 60 * 60 * 1000)
  const lift = Math.sin((index - 4) / 4) * 34_000 + Math.cos(index / 7) * 18_000
  const codex = Math.round(172_000 + lift + index * 2_100)
  const claude = Math.round(148_000 + Math.cos(index / 4.4) * 29_000 + index * 1_650)
  const cursor = Math.round(82_000 + Math.sin(index / 3.2) * 15_000 + index * 880)
  const gemini = Math.round(56_000 + Math.cos(index / 5.2) * 11_000 + index * 520)
  const opencode = Math.round(42_000 + Math.sin(index / 5.5) * 8_000 + index * 390)
  const custom = Math.round(18_000 + Math.sin(index / 6.5) * 4_000 + index * 180)
  return {
    date: date.toISOString().slice(0, 10),
    codex,
    claude,
    cursor,
    gemini,
    opencode,
    custom,
    total: codex + claude + cursor + gemini + opencode + custom,
  }
})

export const mockSnapshot: DashboardSnapshot = {
  generatedAt: now.toISOString(),
  overview: {
    totalSessions: 128,
    backedUpSessions: 104,
    reclaimableBytes: 13.9 * GB,
    lastBackupAt: ago(3),
    totalTokens: 12_430_000,
    totalCostUsd: sessions.reduce((total, session) => total + (session.tokens.costUsd ?? 0), 0),
    totalSizeBytes: 46.2 * GB,
    highRiskCleanupCount: 0,
  },
  agents: [
    {
      source: 'codex',
      name: 'Codex',
      installed: true,
      readable: true,
      rootPaths: ['~/.codex/sessions'],
      sessionCount: 46,
      sizeBytes: 13.2 * GB,
      lastScannedAt: ago(0.1),
    },
    {
      source: 'claude',
      name: 'Claude Code',
      installed: true,
      readable: true,
      rootPaths: ['~/.claude/projects'],
      sessionCount: 38,
      sizeBytes: 19.8 * GB,
      lastScannedAt: ago(0.1),
    },
    {
      source: 'cursor',
      name: 'Cursor',
      installed: true,
      readable: true,
      rootPaths: ['~/Library/Application Support/Cursor'],
      sessionCount: 22,
      sizeBytes: 8.9 * GB,
      lastScannedAt: ago(0.1),
    },
    {
      source: 'gemini',
      name: 'Gemini',
      installed: true,
      readable: true,
      rootPaths: ['~/.gemini'],
      sessionCount: 14,
      sizeBytes: 4.2 * GB,
      lastScannedAt: ago(0.1),
    },
    {
      source: 'opencode',
      name: 'OpenCode',
      installed: true,
      readable: true,
      rootPaths: ['~/.local/share/opencode'],
      sessionCount: 8,
      sizeBytes: 3.0 * GB,
      lastScannedAt: ago(0.1),
    },
    {
      source: 'custom',
      name: 'Custom',
      installed: false,
      readable: false,
      rootPaths: [],
      sessionCount: 0,
      sizeBytes: 0,
      lastScannedAt: ago(0.1),
    },
  ],
  sessions,
  cleanup: [
    {
      id: 'cleanup-codex-archive',
      kind: 'backed-up-session',
      title: 'Archived Codex sessions',
      source: 'codex',
      sessionIds: ['demo-codex-2'],
      paths: ['/demo/codex/archive'],
      sizeBytes: 4.8 * GB,
      lastUpdated: ago(840),
      reason: 'Backed up and inactive for more than 30 days.',
      risk: 'low',
      recoverable: true,
      backedUp: true,
    },
    {
      id: 'cleanup-claude-logs',
      kind: 'large-log',
      title: 'Large Claude Code logs',
      source: 'claude',
      sessionIds: ['demo-claude-2'],
      paths: ['/demo/claude/logs'],
      sizeBytes: 3.6 * GB,
      lastUpdated: ago(510),
      reason: 'Verbose logs from completed debugging sessions are safe after backup.',
      risk: 'medium',
      recoverable: true,
      backedUp: false,
    },
    {
      id: 'cleanup-cursor-backups',
      kind: 'duplicate-backup',
      title: 'Duplicate Cursor backups',
      source: 'cursor',
      sessionIds: ['demo-cursor-2'],
      paths: ['/demo/backups/cursor'],
      sizeBytes: 2.7 * GB,
      lastUpdated: ago(300),
      reason: 'Multiple backup bundles match the same session id and size.',
      risk: 'low',
      recoverable: true,
      backedUp: true,
    },
    {
      id: 'cleanup-gemini-cache',
      kind: 'temp-file',
      title: 'Gemini research cache',
      source: 'gemini',
      sessionIds: ['demo-gemini-1'],
      paths: ['/demo/gemini/cache'],
      sizeBytes: 2.1 * GB,
      lastUpdated: ago(180),
      reason: 'Temporary search context cache can be regenerated on demand.',
      risk: 'low',
      recoverable: true,
      backedUp: true,
    },
    {
      id: 'cleanup-opencode-orphans',
      kind: 'orphan-session',
      title: 'OpenCode orphan sessions',
      source: 'opencode',
      sessionIds: ['demo-opencode-1'],
      paths: ['/demo/opencode/orphans'],
      sizeBytes: 0.7 * GB,
      lastUpdated: ago(420),
      reason: 'No matching project metadata was found for these old session files.',
      risk: 'medium',
      recoverable: true,
      backedUp: false,
    },
  ],
  backups: [
    {
      id: 'backup-demo-codex',
      sessionId: 'demo-codex-1',
      source: 'codex',
      title: 'Polish cleanup queue layout',
      createdAt: ago(3),
      sizeBytes: 408 * MB,
      backupPath: '/demo/backups/codex/demo-codex-1.jsonl',
      originalPath: '/demo/codex/demo-codex-1.jsonl',
      format: 'raw-copy',
    },
  ],
  archives: sessions
    .filter((session) => session.storageState === 'archived')
    .map((session) => ({
      id: `archive-${session.id}`,
      sessionId: session.id,
      source: session.source,
      title: session.title,
      createdAt: session.createdAt ?? ago(72),
      archivedAt: ago(12),
      originalPath: `/demo/${session.source}/${session.id}.jsonl`,
      archivePath: `/demo/vault/${session.source}/${session.id}.jsonl.br`,
      originalBytes: session.sizeBytes,
      compressedBytes: Math.round(session.sizeBytes * 0.18),
      contentHash: `demo-${session.id}`,
      compression: 'brotli',
      restorable: true,
      session,
    })),
  trash: [],
  usage,
  storage: [
    { source: 'claude', label: 'Claude Code', sizeBytes: 19.8 * GB, sessions: 38 },
    { source: 'codex', label: 'Codex', sizeBytes: 13.2 * GB, sessions: 46 },
    { source: 'cursor', label: 'Cursor', sizeBytes: 8.9 * GB, sessions: 22 },
    { source: 'gemini', label: 'Gemini', sizeBytes: 4.2 * GB, sessions: 14 },
    { source: 'opencode', label: 'OpenCode', sizeBytes: 3.0 * GB, sessions: 8 },
    { source: 'archives', label: 'Vault', sizeBytes: 1.7 * GB, sessions: 4 },
  ],
}
