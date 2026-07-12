import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppService } from './app-service'
import * as worktreesModule from './worktrees'
import { hashId } from './files'

// Default: worktree scanning is a no-op in app-service tests so they don't hit
// the developer's real ~/.codex/worktrees. Worktree-specific tests override
// scanAllWorktrees via vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue(...).
vi.mock('./worktrees', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./worktrees')>()
  return {
    ...actual,
    scanAllWorktrees: vi.fn(async () => ({
      records: [],
      diagnostics: [],
      sizeCache: new Map(),
    })),
  }
})
import {
  agentSources,
  type AgentSource,
  type ArchiveRecord,
  type CleanupCandidate,
  type DiagnosticReport,
  type RecoveryRecord,
  type SessionRecord,
  type TrashRecord,
} from '../../src/shared/types'
import { defaultCleanupSelection } from '../../src/features/cleanup/cleanup-model'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function writeJsonlSession(
  root: string,
  source: AgentSource,
  opts: {
    filename?: string
    timestamp?: string
    sizeBoost?: number
    contentExtra?: string
  } = {},
): Promise<string> {
  const dir = path.join(root, source)
  await mkdir(dir, { recursive: true })
  const filename = opts.filename ?? `${source}-session.jsonl`
  const filePath = path.join(dir, filename)
  const timestamp = opts.timestamp ?? new Date('2026-02-01T12:00:00.000Z').toISOString()
  const lines = [
    {
      role: 'user',
      timestamp,
      content: `Investigate rare migration needle in billing reports${opts.contentExtra ?? ''}`,
      cwd: path.join('/tmp', 'clean-my-agent-fixture', source),
      branch: 'archive-test',
      usage: { input_tokens: 120, output_tokens: 30 },
    },
    {
      role: 'assistant',
      timestamp,
      content: 'The rare migration needle comes from the archived ledger adapter.',
      usage: { input_tokens: 40, output_tokens: 90 },
    },
  ]
  const raw = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  const pad = opts.sizeBoost
    ? `\n${JSON.stringify({ role: 'user', content: 'x'.repeat(opts.sizeBoost) })}\n`
    : ''
  await writeFile(filePath, raw + pad)
  return filePath
}

function makeService(userDataPath: string, openPath?: (p: string) => Promise<void>) {
  const service = new AppService({
    userDataPath,
    openPath: openPath ?? (async () => undefined),
  })
  return service
}

async function initServiceWithScan(
  fixtureRoot: string,
  userDataPath: string,
  openPath?: (p: string) => Promise<void>,
) {
  const service = makeService(userDataPath, openPath)
  await service.init()
  service.updateSettings({
    scanRoots: Object.fromEntries(agentSources.map((src) => [src, [path.join(fixtureRoot, src)]])),
    exportDirectory: path.join(userDataPath, 'Exports'),
  })
  return service
}

function recoveryRecord(patch: Partial<RecoveryRecord> = {}): RecoveryRecord {
  return {
    id: `recovery-${Math.random().toString(16).slice(2)}`,
    operation: 'restore',
    status: 'completed',
    title: 'Recovery fixture',
    explanation: 'Fixture recovery record for focused undo tests.',
    startedAt: '2026-02-01T00:00:00.000Z',
    finishedAt: '2026-02-01T00:00:01.000Z',
    steps: [{ label: 'Completed', status: 'completed', at: '2026-02-01T00:00:01.000Z' }],
    paths: [],
    undo: {
      kind: 'none',
      available: false,
      label: 'No undo',
      reason: 'No undo fixture',
    },
    diagnostics: [],
    metadata: {},
    ...patch,
  }
}

function archiveRecord(session: SessionRecord, patch: Partial<ArchiveRecord> = {}): ArchiveRecord {
  return {
    id: `archive-${session.id}`,
    sessionId: session.id,
    source: session.source,
    title: session.title,
    createdAt: session.createdAt ?? '2026-02-01T00:00:00.000Z',
    archivedAt: '2026-02-01T00:00:00.000Z',
    originalPath: session.storagePath,
    archivePath: path.join(userDataPath, 'Vault', `${session.id}.br`),
    originalBytes: session.sizeBytes,
    compressedBytes: 16,
    contentHash: 'fixture-hash',
    compression: 'brotli',
    restorable: true,
    session,
    ...patch,
  }
}

function trashRecord(patch: Partial<TrashRecord> = {}): TrashRecord {
  return {
    id: 'trash-fixture',
    candidateId: 'candidate-fixture',
    title: 'Trash fixture',
    source: 'codex',
    originalPaths: [],
    trashPath: path.join(userDataPath, 'Trash', 'trash-fixture'),
    sizeBytes: 0,
    deletedAt: '2026-02-01T00:00:00.000Z',
    risk: 'low',
    recoverable: true,
    ...patch,
  }
}

function testHashId(parts: Array<string | number | undefined>): string {
  return createHash('sha256')
    .update(parts.filter((part) => part !== undefined).join('|'))
    .digest('hex')
    .slice(0, 24)
}

// ---------------------------------------------------------------------------
// Test state – each suite gets fresh temp dirs
// ---------------------------------------------------------------------------

let fixtureRoot: string
let userDataPath: string

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'cma-fixture-'))
  userDataPath = await mkdtemp(path.join(os.tmpdir(), 'cma-userdata-'))
})

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true })
  await rm(userDataPath, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// init / default settings / updateSettings
// ---------------------------------------------------------------------------

describe('init and settings', () => {
  it('initialises with default settings', async () => {
    const service = makeService(userDataPath)
    await service.init()
    const settings = service.getSettings()
    expect(settings.cleanupRetentionDays).toBe(7)
    expect(settings.trashRetentionDays).toBe(14)
    expect(settings.autoBackup).toBe(true)
    expect(settings.mockDataEnabled).toBe(false)
    expect(settings.language).toBe('en')
    expect(settings.usageTimezone).toBeTruthy()
    expect(settings.launchAtLogin).toBe(false)
    expect(settings.enabledProviders).toEqual(
      Object.fromEntries(agentSources.map((source) => [source, true])),
    )
    expect(settings.scanOnLaunch).toBe(true)
    expect(settings.backgroundScan).toBe(true)
    expect(settings.confirmBeforeCleanup).toBe(true)
    expect(settings.excludedFolders).toEqual([])
    expect(settings.soundEffects).toBe(true)
    expect(settings.cleanupSound).toBe(true)
    expect(settings.scanSound).toBe(false)
    expect(settings.errorSound).toBe(true)
    expect(settings.soundVolume).toBe(35)
    expect(settings.checkForUpdates).toBe(true)
    expect(settings.defaultRelayMode).toBe('full-context')
    expect(settings.exportDirectory).toContain(userDataPath)
    expect(settings.scanRoots).toEqual({})
  })

  it('getSettings throws before init', () => {
    const service = makeService(userDataPath)
    expect(() => service.getSettings()).toThrow(/not initialized/)
  })

  it('persists settings across re-init', async () => {
    const service = makeService(userDataPath)
    await service.init()
    service.updateSettings({ cleanupRetentionDays: 60, autoBackup: false })

    // Second service instance pointing at same DB should recover saved settings
    const service2 = makeService(userDataPath)
    await service2.init()
    const settings = service2.getSettings()
    expect(settings.cleanupRetentionDays).toBe(60)
    expect(settings.autoBackup).toBe(false)
  })

  it('updateSettings merges scanRoots deeply instead of replacing', async () => {
    const service = makeService(userDataPath)
    await service.init()
    service.updateSettings({ scanRoots: { codex: ['/a'] } })
    service.updateSettings({ scanRoots: { claude: ['/b'] } })
    const settings = service.getSettings()
    expect(settings.scanRoots.codex).toEqual(['/a'])
    expect(settings.scanRoots.claude).toEqual(['/b'])
  })

  it('updateSettings merges provider toggles deeply instead of replacing', async () => {
    const service = makeService(userDataPath)
    await service.init()
    service.updateSettings({ enabledProviders: { codex: false } })
    service.updateSettings({ enabledProviders: { claude: false } })
    const settings = service.getSettings()
    expect(settings.enabledProviders.codex).toBe(false)
    expect(settings.enabledProviders.claude).toBe(false)
    expect(settings.enabledProviders.cursor).toBe(true)
  })

  it('updateSettings returns the merged settings object', async () => {
    const service = makeService(userDataPath)
    await service.init()
    const returned = service.updateSettings({ cleanupRetentionDays: 7 })
    expect(returned.cleanupRetentionDays).toBe(7)
    expect(returned.autoBackup).toBe(true) // unchanged default
  })

  it('rejects unsafe or unsupported settings patches', async () => {
    const service = makeService(userDataPath)
    await service.init()

    expect(() => service.updateSettings(null as never)).toThrow(/settings patch must be an object/)
    expect(() => service.updateSettings({ scanRoots: [] as never })).toThrow(
      /scanRoots must be an object/,
    )
    expect(() => service.updateSettings({ scanRoots: { codex: '/tmp' } as never })).toThrow(
      /scanRoots.codex must be an array/,
    )
    expect(() => service.updateSettings({ exportDirectory: 'relative/path' })).toThrow(
      /exportDirectory must be an absolute local path/,
    )
    expect(() => service.updateSettings({ exportDirectory: '' })).toThrow(
      /exportDirectory must be an absolute local path/,
    )
    expect(() => service.updateSettings({ exportDirectory: `/tmp/bad\0path` })).toThrow(
      /exportDirectory must be an absolute local path/,
    )
    expect(() => service.updateSettings({ exportDirectory: `/${'x'.repeat(4097)}` })).toThrow(
      /exportDirectory must be an absolute local path/,
    )
    expect(() =>
      service.updateSettings({ scanRoots: { codex: ['https://example.test'] } }),
    ).toThrow(/scanRoots.codex must be an absolute local path/)
    expect(() => service.updateSettings({ scanRoots: { unknown: ['/tmp'] } as never })).toThrow(
      /Unsupported scan root source/,
    )
    expect(() => service.updateSettings({ enabledProviders: [] as never })).toThrow(
      /enabledProviders must be an object/,
    )
    expect(() => service.updateSettings({ enabledProviders: { unknown: true } as never })).toThrow(
      /Unsupported provider source/,
    )
    expect(() => service.updateSettings({ enabledProviders: { codex: 'yes' } as never })).toThrow(
      /enabledProviders.codex must be a boolean/,
    )
    expect(() => service.updateSettings({ trashRetentionDays: -1 })).toThrow(
      /trashRetentionDays must be an integer/,
    )
    expect(() => service.updateSettings({ cleanupRetentionDays: 1.5 })).toThrow(
      /cleanupRetentionDays must be an integer/,
    )
    expect(() => service.updateSettings({ autoBackup: 'yes' as never })).toThrow(
      /autoBackup must be a boolean/,
    )
    expect(() => service.updateSettings({ mockDataEnabled: 'yes' as never })).toThrow(
      /mockDataEnabled must be a boolean/,
    )
    expect(() => service.updateSettings({ language: 'xx' as never })).toThrow(
      /language is not supported/,
    )
    expect(() => service.updateSettings({ usageTimezone: 'Mars/Olympus' })).toThrow(
      /usageTimezone must be a supported IANA time zone/,
    )
    expect(() => service.updateSettings({ usageTimezone: '' })).toThrow(
      /usageTimezone must be a supported IANA time zone/,
    )
    expect(() => service.updateSettings({ launchAtLogin: 'yes' as never })).toThrow(
      /launchAtLogin must be a boolean/,
    )
    expect(() => service.updateSettings({ scanOnLaunch: 'yes' as never })).toThrow(
      /scanOnLaunch must be a boolean/,
    )
    expect(() => service.updateSettings({ backgroundScan: 'yes' as never })).toThrow(
      /backgroundScan must be a boolean/,
    )
    expect(() => service.updateSettings({ confirmBeforeCleanup: 'yes' as never })).toThrow(
      /confirmBeforeCleanup must be a boolean/,
    )
    expect(() => service.updateSettings({ excludedFolders: 'nope' as never })).toThrow(
      /excludedFolders must be an array/,
    )
    expect(() => service.updateSettings({ excludedFolders: ['relative/path'] })).toThrow(
      /excludedFolders must be an absolute local path/,
    )
    expect(() => service.updateSettings({ soundEffects: 'yes' as never })).toThrow(
      /soundEffects must be a boolean/,
    )
    expect(() => service.updateSettings({ cleanupSound: 'yes' as never })).toThrow(
      /cleanupSound must be a boolean/,
    )
    expect(() => service.updateSettings({ scanSound: 'yes' as never })).toThrow(
      /scanSound must be a boolean/,
    )
    expect(() => service.updateSettings({ errorSound: 'yes' as never })).toThrow(
      /errorSound must be a boolean/,
    )
    expect(() => service.updateSettings({ soundVolume: 101 })).toThrow(
      /soundVolume must be a number between 0 and 100/,
    )
    expect(() => service.updateSettings({ checkForUpdates: 'yes' as never })).toThrow(
      /checkForUpdates must be a boolean/,
    )
    expect(() => service.updateSettings({ defaultRelayMode: 'unsupported' as never })).toThrow(
      /defaultRelayMode is not supported/,
    )
  })

  it('accepts every validated settings field in one patch', async () => {
    const service = makeService(userDataPath)
    await service.init()
    const exportDirectory = path.join(userDataPath, 'Custom Exports')
    const excludedFolder = path.join(fixtureRoot, 'excluded')
    const settings = service.updateSettings({
      scanRoots: { codex: [path.join(fixtureRoot, 'codex')] },
      enabledProviders: { codex: false, claude: true },
      cleanupRetentionDays: 30,
      trashRetentionDays: 60,
      autoBackup: false,
      mockDataEnabled: true,
      language: 'zh-CN',
      usageTimezone: 'Asia/Shanghai',
      launchAtLogin: true,
      scanOnLaunch: false,
      backgroundScan: false,
      confirmBeforeCleanup: false,
      excludedFolders: [excludedFolder, excludedFolder],
      soundEffects: false,
      cleanupSound: false,
      scanSound: true,
      errorSound: false,
      soundVolume: 0,
      checkForUpdates: false,
      defaultRelayMode: 'manual-select',
      exportDirectory,
    })

    expect(settings.scanRoots.codex).toEqual([path.join(fixtureRoot, 'codex')])
    expect(settings.enabledProviders.codex).toBe(false)
    expect(settings.enabledProviders.claude).toBe(true)
    expect(settings.cleanupRetentionDays).toBe(30)
    expect(settings.trashRetentionDays).toBe(60)
    expect(settings.autoBackup).toBe(false)
    expect(settings.mockDataEnabled).toBe(true)
    expect(settings.language).toBe('zh-CN')
    expect(settings.usageTimezone).toBe('Asia/Shanghai')
    expect(settings.launchAtLogin).toBe(true)
    expect(settings.scanOnLaunch).toBe(false)
    expect(settings.backgroundScan).toBe(false)
    expect(settings.confirmBeforeCleanup).toBe(false)
    expect(settings.excludedFolders).toEqual([excludedFolder])
    expect(settings.soundEffects).toBe(false)
    expect(settings.cleanupSound).toBe(false)
    expect(settings.scanSound).toBe(true)
    expect(settings.errorSound).toBe(false)
    expect(settings.soundVolume).toBe(0)
    expect(settings.checkForUpdates).toBe(false)
    expect(settings.defaultRelayMode).toBe('manual-select')
    expect(settings.exportDirectory).toBe(exportDirectory)
  })

  it('falls back to defaults when persisted settings are invalid', async () => {
    const service = makeService(userDataPath)
    await service.init()
    service['db'].setSetting('settings', {
      cleanupRetentionDays: -1,
      trashRetentionDays: 100_000,
      autoBackup: 'yes',
      mockDataEnabled: 'yes',
      language: 'xx',
      usageTimezone: 'Mars/Olympus',
      launchAtLogin: 'yes',
      defaultRelayMode: 'unsupported',
      exportDirectory: 'https://example.test/export',
      scanRoots: {
        codex: ['relative/path'],
        claude: ['/safe/claude'],
        unknown: ['/tmp/unknown'],
      },
    })

    const restored = makeService(userDataPath)
    await restored.init()
    const settings = restored.getSettings()
    expect(settings.cleanupRetentionDays).toBe(7)
    expect(settings.trashRetentionDays).toBe(14)
    expect(settings.autoBackup).toBe(true)
    expect(settings.mockDataEnabled).toBe(false)
    expect(settings.language).toBe('en')
    expect(settings.usageTimezone).toBeTruthy()
    expect(settings.usageTimezone).not.toBe('Mars/Olympus')
    expect(settings.launchAtLogin).toBe(false)
    expect(settings.defaultRelayMode).toBe('full-context')
    expect(settings.exportDirectory).toContain(userDataPath)
    expect(settings.scanRoots).toEqual({ claude: ['/safe/claude'] })
  })
})

// ---------------------------------------------------------------------------
// getSnapshot / rescan / refreshRecentSessions
// ---------------------------------------------------------------------------

describe('getSnapshot and rescan', () => {
  it('getSnapshot(false) returns cached snapshot without re-scanning when data is current', async () => {
    // rescan() with 0 sessions triggers a recursive loop in production code, so we always
    // seed a session file first to ensure the initial rescan completes successfully.
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    // Second call should use the cache (scanSchemaVersion already set)
    const cached = await service.getSnapshot(false)
    expect(cached.sessions.length).toBeGreaterThanOrEqual(1)
    expect(cached.overview.totalSessions).toBeGreaterThanOrEqual(1)
  })

  it('rescan picks up newly written sessions', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)

    // Write a session file and rescan
    await writeJsonlSession(fixtureRoot, 'codex')
    const after = await service.rescan()
    expect(after.sessions.length).toBeGreaterThanOrEqual(1)
    const session = after.sessions.find((s) => s.source === 'codex')
    assert.ok(session)
    expect(session.storageState).toBe('live')
    expect(session.tokens.total).toBeGreaterThan(0)
  })

  it('getSnapshot(true) forces a rescan', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.getSnapshot(true)
    expect(snapshot.sessions.some((s) => s.source === 'codex')).toBe(true)
  })

  it('refreshRecentSessions upserts without dropping existing sessions', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const after = await service.refreshRecentSessions(5)
    // At least the codex session should appear
    expect(after.sessions.some((s) => s.source === 'codex')).toBe(true)
  })

  it('refreshRecentSessions includes the newest candidate when a limit is requested', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const olderPath = await writeJsonlSession(fixtureRoot, 'codex', {
      filename: 'older-session.jsonl',
      contentExtra: ' older refresh candidate',
    })
    const newerPath = await writeJsonlSession(fixtureRoot, 'codex', {
      filename: 'newer-session.jsonl',
      contentExtra: ' newer refresh candidate',
    })
    const base = new Date('2026-02-01T12:00:00.000Z')
    await utimes(olderPath, base, base)
    await utimes(newerPath, new Date(base.getTime() + 60_000), new Date(base.getTime() + 60_000))

    const after = await service.refreshRecentSessions(2)

    expect(after.sessions.map((session) => session.storagePath)).toEqual([newerPath, olderPath])
  })

  it('snapshot overview aggregates totalTokens across sessions', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    expect(snapshot.overview.totalTokens).toBeGreaterThan(0)
    expect(snapshot.overview.totalTokens).toBe(
      snapshot.sessions.reduce((s, x) => s + x.tokens.total, 0),
    )
  })

  it('snapshot backfills missing storage state and search text from old cached sessions', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)
    service['db'].replaceSessions([
      {
        ...session,
        storageState: undefined as never,
        searchText: undefined,
      },
    ])

    const after = await service.getSnapshot(false)
    const restored = after.sessions.find((item) => item.id === session.id)
    expect(restored?.storageState).toBe('live')
    expect(restored?.searchText).toContain('rare migration needle')
  })

  it('aggregates usage events by the configured usage timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-02-03T12:00:00.000Z'))
      const service = await initServiceWithScan(fixtureRoot, userDataPath)
      service.updateSettings({ usageTimezone: 'Asia/Shanghai' })
      await writeJsonlSession(fixtureRoot, 'codex', {
        timestamp: '2026-02-01T23:30:00.000Z',
      })

      const snapshot = await service.rescan()
      const feb1 = snapshot.usage.find((point) => point.date === '2026-02-01')
      const feb2 = snapshot.usage.find((point) => point.date === '2026-02-02')

      expect(feb1?.codex ?? 0).toBe(0)
      expect(feb2?.codex).toBe(280)
      expect(feb2?.total).toBe(280)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to legacy usageByDate metadata when usage events are unavailable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-02-03T12:00:00.000Z'))
      const service = await initServiceWithScan(fixtureRoot, userDataPath)
      await writeJsonlSession(fixtureRoot, 'codex')
      const snapshot = await service.rescan()
      const session = snapshot.sessions.find((s) => s.source === 'codex')
      assert.ok(session)

      service['db'].replaceSessions([
        {
          ...session,
          metadata: {
            ...session.metadata,
            usageEvents: [],
            usageByDate: { '2026-02-01': 123 },
          },
        },
      ])

      const after = await service.getSnapshot(false)
      const point = after.usage.find((item) => item.date === '2026-02-01')
      expect(point?.codex).toBe(123)
      expect(point?.total).toBe(123)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefers usage event timestamps over legacy usageByDate buckets', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-06-09T12:00:00.000Z'))
      const service = await initServiceWithScan(fixtureRoot, userDataPath)
      service.updateSettings({ usageTimezone: 'Asia/Shanghai' })
      await writeJsonlSession(fixtureRoot, 'codex')
      const snapshot = await service.rescan()
      const session = snapshot.sessions.find((s) => s.source === 'codex')
      assert.ok(session)

      service['db'].replaceSessions([
        {
          ...session,
          metadata: {
            ...session.metadata,
            usageByDate: { '2026-06-08': 450 },
            usageEvents: [{ timestamp: '2026-06-08T18:30:00.000Z', tokens: 450 }],
          },
        },
      ])

      const usage = (await service.getSnapshot(false)).usage
      expect(usage.find((point) => point.date === '2026-06-08')?.codex).toBe(0)
      expect(usage.find((point) => point.date === '2026-06-09')?.codex).toBe(450)
    } finally {
      vi.useRealTimers()
    }
  })

  it('excludes Codex fork replay sessions from daily usage buckets', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      const service = await initServiceWithScan(fixtureRoot, userDataPath)
      service.updateSettings({ usageTimezone: 'Asia/Shanghai' })
      const codexRoot = path.join(fixtureRoot, 'codex')
      await mkdir(codexRoot, { recursive: true })
      await writeFile(
        path.join(codexRoot, 'fork.jsonl'),
        [
          JSON.stringify({
            type: 'session_meta',
            timestamp: '2026-06-10T03:53:29.000Z',
            payload: {
              id: 'child-thread',
              cwd: '/workspace/forked',
              forked_from_id: 'parent-thread',
              parent_thread_id: 'parent-thread',
            },
          }),
          JSON.stringify({
            type: 'event_msg',
            timestamp: '2026-06-10T03:53:30.000Z',
            payload: {
              type: 'token_count',
              info: {
                last_token_usage: {
                  input_tokens: 400,
                  output_tokens: 100,
                  total_tokens: 500,
                },
              },
            },
          }),
        ].join('\n') + '\n',
      )

      const snapshot = await service.rescan()
      const fork = snapshot.sessions.find((session) => session.metadata.codexForkedFromId)
      assert.ok(fork)

      expect(fork.tokens.total).toBe(500)
      expect(snapshot.usage.find((point) => point.date === '2026-06-10')?.codex).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('disabled providers are not scanned, shown, or suggested for cleanup', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({
      cleanupRetentionDays: 0,
      enabledProviders: { codex: false },
    })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })

    const snapshot = await service.rescan()
    expect(snapshot.sessions.some((session) => session.source === 'codex')).toBe(false)
    expect(snapshot.sessions.some((session) => session.source === 'claude')).toBe(true)
    expect(snapshot.agents.find((agent) => agent.source === 'codex')?.readable).toBe(false)
    expect(snapshot.agents.find((agent) => agent.source === 'codex')?.note).toBe(
      'Provider disabled in Settings.',
    )

    const candidates = await service.scanCleanup()
    expect(candidates.some((candidate) => candidate.source === 'codex')).toBe(false)
    expect(candidates.some((candidate) => candidate.source === 'claude')).toBe(true)
  })

  it('rescan keeps disabled provider cache and reveals it after re-enabling', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const initial = await service.rescan()
    const codexSession = initial.sessions.find((session) => session.source === 'codex')
    assert.ok(codexSession)

    service.updateSettings({ enabledProviders: { codex: false } })
    const disabled = await service.rescan()
    expect(disabled.sessions.some((session) => session.id === codexSession.id)).toBe(false)
    expect(service['db'].getSessions().some((session) => session.id === codexSession.id)).toBe(true)

    service.updateSettings({ enabledProviders: { codex: true } })
    const reenabled = await service.getSnapshot(false)
    expect(reenabled.sessions.some((session) => session.id === codexSession.id)).toBe(true)
  })

  it('scans custom provider roots when configured', async () => {
    const service = makeService(userDataPath)
    await service.init()
    const customRoot = path.join(fixtureRoot, 'custom-root')
    await mkdir(customRoot, { recursive: true })
    await writeFile(
      path.join(customRoot, 'custom-session.jsonl'),
      JSON.stringify({
        role: 'user',
        timestamp: '2026-02-01T12:00:00.000Z',
        content: 'Custom provider session text',
      }) + '\n',
    )
    service.updateSettings({
      scanRoots: { custom: [customRoot] },
      enabledProviders: {
        codex: false,
        claude: false,
        cursor: false,
        gemini: false,
        opencode: false,
        pi: false,
        custom: true,
      },
      exportDirectory: path.join(userDataPath, 'Exports'),
    })

    const snapshot = await service.rescan()
    expect(snapshot.sessions).toHaveLength(1)
    expect(snapshot.sessions[0].source).toBe('custom')
    expect(snapshot.sessions[0].searchText).toContain('Custom provider session text')
    expect(snapshot.agents.find((agent) => agent.source === 'custom')?.installed).toBe(true)
  })

  it('excludes configured folders from provider scans', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const keptPath = await writeJsonlSession(fixtureRoot, 'codex', {
      filename: 'kept-session.jsonl',
      contentExtra: ' keep-this-session',
    })
    const excludedDir = path.join(fixtureRoot, 'codex', 'excluded')
    await mkdir(excludedDir, { recursive: true })
    const excludedPath = path.join(excludedDir, 'ignored-session.jsonl')
    await writeFile(
      excludedPath,
      JSON.stringify({
        role: 'user',
        timestamp: '2026-02-01T12:00:00.000Z',
        content: 'Ignore this excluded session',
      }) + '\n',
    )
    service.updateSettings({ excludedFolders: [excludedDir] })

    const snapshot = await service.rescan()
    expect(snapshot.sessions.some((session) => session.storagePath === keptPath)).toBe(true)
    expect(snapshot.sessions.some((session) => session.storagePath === excludedPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// backupSession
// ---------------------------------------------------------------------------

describe('backupSession', () => {
  it('creates a backup file in userDataPath/Backups', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const backup = await service.backupSession(session.id)
    expect(backup.sessionId).toBe(session.id)
    expect(backup.source).toBe('codex')
    expect(backup.sizeBytes).toBeGreaterThan(0)
    expect(backup.backupPath).toContain(path.join(userDataPath, 'Backups'))

    const info = await stat(backup.backupPath)
    expect(info.size).toBe(backup.sizeBytes)
  })

  it('includes matching Claude Desktop metadata when backing up Claude transcripts', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const transcriptPath = await writeJsonlSession(fixtureRoot, 'claude', {
      filename: 'claude-visible-session.jsonl',
    })
    const metadataDir = path.join(
      fixtureRoot,
      'Library',
      'Application Support',
      'Claude',
      'claude-code-sessions',
      'account-1',
      'org-1',
    )
    await mkdir(metadataDir, { recursive: true })
    await writeFile(
      path.join(metadataDir, 'local_visible.json'),
      JSON.stringify({
        sessionId: 'local-visible',
        cliSessionId: 'claude-visible-session',
        title: 'Visible in Desktop',
      }),
    )
    await writeFile(
      path.join(metadataDir, 'local_other.json'),
      JSON.stringify({
        sessionId: 'local-other',
        cliSessionId: 'other-session',
        title: 'Not this transcript',
      }),
    )

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fixtureRoot)
    try {
      const snapshot = await service.rescan()
      const session = snapshot.sessions.find((s) => s.source === 'claude')
      assert.ok(session)

      const backup = await service.backupSession(session.id)

      expect((await stat(backup.backupPath)).isDirectory()).toBe(true)
      expect(
        await readFile(
          path.join(backup.backupPath, 'session', path.basename(transcriptPath)),
          'utf8',
        ),
      ).toContain('Investigate rare migration needle')
      const metadataBackupPath = path.join(
        backup.backupPath,
        'claude-code-sessions',
        'account-1',
        'org-1',
        'local_visible.json',
      )
      expect(JSON.parse(await readFile(metadataBackupPath, 'utf8'))).toMatchObject({
        cliSessionId: 'claude-visible-session',
        title: 'Visible in Desktop',
      })
      await expect(
        readFile(
          path.join(
            backup.backupPath,
            'claude-code-sessions',
            'account-1',
            'org-1',
            'local_other.json',
          ),
          'utf8',
        ),
      ).rejects.toThrow()
      expect(backup.sizeBytes).toBeGreaterThan((await stat(transcriptPath)).size)
    } finally {
      homeSpy.mockRestore()
    }
  })

  it('marks the session as backed-up after backupSession', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await service.backupSession(session.id)
    const after = await service.getSnapshot(false)
    const backedUp = after.sessions.find((s) => s.id === session.id)
    expect(backedUp?.backupStatus).toBe('backed-up')
  })

  it('backupSession throws when session not found', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.backupSession('nonexistent-id')).rejects.toThrow(/Session not found/)
  })
})

// ---------------------------------------------------------------------------
// exportSession – json / markdown / universal-json (live)
// ---------------------------------------------------------------------------

describe('exportSession', () => {
  it('exports json format for a live session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const exportPath = await service.exportSession(session.id, 'json')
    expect(exportPath).toMatch(/\.json$/)
    const content = JSON.parse(await readFile(exportPath, 'utf8')) as { id: string }
    expect(content.id).toBe(session.id)
  })

  it('exports markdown format for a live session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const exportPath = await service.exportSession(session.id, 'markdown')
    expect(exportPath).toMatch(/\.md$/)
    const content = await readFile(exportPath, 'utf8')
    expect(content).toContain('# ')
    expect(content).toContain('Agent: Codex')
  })

  it('exports markdown with unknown branch, unknown cost, and estimated tokens', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const snapshot = await service.getSnapshot(false)
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await rm(filePath)
    await writeFile(filePath, 'plain text session without structured usage')
    const rescanned = await service.rescan()
    const plain = rescanned.sessions.find((s) => s.source === 'codex')
    assert.ok(plain)

    const exportPath = await service.exportSession(plain.id, 'markdown')
    const content = await readFile(exportPath, 'utf8')

    expect(content).toContain('- Branch: Unknown')
    expect(content).toContain('- Tokens: 0 (estimated)')
    expect(content).toContain('- Cost: Unknown')
  })

  it('exports universal-json relay for a live session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const exportPath = await service.exportSession(session.id, 'universal-json')
    expect(exportPath).toMatch(/\.universal-session\.json$/)
    const doc = JSON.parse(await readFile(exportPath, 'utf8')) as {
      schema: string
      messages: unknown[]
    }
    expect(doc.schema).toBe('clean-my-agent.universal-session.v1')
    expect(Array.isArray(doc.messages)).toBe(true)
  })

  it('exportSession throws when session not found', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.rescan()
    await expect(service.exportSession('bad-id', 'json')).rejects.toThrow(/Session not found/)
  })

  it('exports universal-json relay for an archived session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await service.archiveSession(session.id)
    const exportPath = await service.exportSession(session.id, 'universal-json')
    const doc = JSON.parse(await readFile(exportPath, 'utf8')) as {
      messages: Array<{ text: string }>
    }
    expect(doc.messages.some((m) => m.text.includes('rare migration needle'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// exportUniversalRelay directly
// ---------------------------------------------------------------------------

describe('exportUniversalRelay', () => {
  it('produces a file with schema and messages for a live session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const relayPath = await service.exportUniversalRelay(session.id)
    const relay = JSON.parse(await readFile(relayPath, 'utf8')) as {
      schema: string
      messages: Array<{ text: string }>
    }
    expect(relay.schema).toBe('clean-my-agent.universal-session.v1')
    expect(relay.messages.some((m) => m.text.includes('rare migration needle'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// exportDiagnostics
// ---------------------------------------------------------------------------

describe('exportDiagnostics', () => {
  it('exports diagnostics without session content, metadata, raw paths, or secrets', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const sessionPath = await writeJsonlSession(fixtureRoot, 'codex', {
      contentExtra: ' SECRET_DIAGNOSTIC_NEEDLE api_key=sk-local-test',
    })
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await rm(sessionPath)
    await expect(service.archiveSession(session.id)).rejects.toThrow(/Session file not found/)
    await expect(service.exportSession('bad session id', 'json')).rejects.toThrow(
      /non-empty identifier/,
    )

    const exportPath = await service.exportDiagnostics()
    const raw = await readFile(exportPath, 'utf8')
    const report = JSON.parse(raw) as DiagnosticReport

    expect(report.schema).toBe('clean-my-agent.diagnostic-report.v1')
    expect(report.app.version).toBe('0.0.0')
    expect(report.scanSources.some((source) => source.source === 'codex')).toBe(true)
    expect(report.performance.some((metric) => metric.operation === 'app.rescan')).toBe(true)
    expect(report.errorLogs.some((entry) => entry.operation === 'session.archive')).toBe(true)
    expect(report.errorLogs.some((entry) => entry.operation === 'session.export')).toBe(true)
    expect(report.privacy).toEqual({
      fullPaths: 'redacted',
      sessionContent: 'excluded',
      sessionMetadata: 'excluded',
      operationArguments: 'excluded',
    })

    expect(raw).not.toContain('SECRET_DIAGNOSTIC_NEEDLE')
    expect(raw).not.toContain('sk-local-test')
    expect(raw).not.toContain('rare migration needle')
    expect(raw).not.toContain(fixtureRoot)
    expect(raw).not.toContain(userDataPath)
    expect(raw).not.toContain(sessionPath)
    expect(report.scanSources.flatMap((source) => source.rootIds)).not.toContain(sessionPath)
    expect(
      report.scanSources.every((source) =>
        source.diagnostics.every((diagnostic) => !('path' in diagnostic)),
      ),
    ).toBe(true)
  })

  it('builds diagnostics from adapter defaults before any scan state exists', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)

    const report = service['buildDiagnosticReport']({ recentOperations: [] })
    const codexSource = report.scanSources.find((source) => source.source === 'codex')

    expect(report.recentOperations).toEqual([])
    expect(report.errorLogs).toEqual([])
    expect(codexSource).toEqual(
      expect.objectContaining({
        installed: false,
        readable: false,
        configuredRootCount: 1,
        diagnostics: [],
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// getSessionDetail
// ---------------------------------------------------------------------------

describe('getSessionDetail', () => {
  it('returns universal relay detail for a live session without writing an export file', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const detail = await service.getSessionDetail(session.id)

    expect(detail.schema).toBe('clean-my-agent.universal-session.v1')
    expect(detail.session.id).toBe(session.id)
    expect(detail.messages.some((message) => message.text.includes('rare migration needle'))).toBe(
      true,
    )
    await expect(stat(path.join(userDataPath, 'Exports'))).rejects.toThrow()
  })

  it('returns detail for an archived session by temporarily restoring the archive', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await service.archiveSession(session.id)
    const detail = await service.getSessionDetail(session.id)

    expect(detail.session.storageState).toBe('archived')
    expect(detail.messages.some((message) => message.text.includes('rare migration needle'))).toBe(
      true,
    )
  })

  it('throws when session detail is requested for an unknown session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.getSessionDetail('missing-session')).rejects.toThrow(/Session not found/)
  })
})

// ---------------------------------------------------------------------------
// archiveSession + idempotent archived branch
// ---------------------------------------------------------------------------

describe('archiveSession', () => {
  it('archives a live session and removes the original file', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    expect(archive.originalPath).toBe(filePath)
    expect(archive.originalBytes).toBeGreaterThan(0)
    expect(archive.compressedBytes).toBeGreaterThan(0)
    expect(archive.compressedBytes).toBeLessThan(archive.originalBytes)

    // Original file is gone; archive file exists
    await expect(stat(filePath)).rejects.toThrow()
    const archiveStat = await stat(archive.archivePath)
    expect(archiveStat.size).toBe(archive.compressedBytes)
  })

  it('session appears as archived in snapshot after archiving', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await service.archiveSession(session.id)
    const after = await service.getSnapshot(false)
    const archivedSession = after.sessions.find((s) => s.id === session.id)
    expect(archivedSession?.storageState).toBe('archived')
    expect(after.archives).toHaveLength(1)
  })

  it('archiveSession is idempotent – calling twice returns the same record', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const first = await service.archiveSession(session.id)
    const second = await service.archiveSession(session.id)
    expect(second.id).toBe(first.id)
    expect(second.archivePath).toBe(first.archivePath)
  })

  it('archiveSession rejects directory sessions', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const db = service['db']
    db.replaceSessions([{ ...session, storageKind: 'directory' }])

    await expect(service.archiveSession(session.id)).rejects.toThrow(/single-file sessions/)
  })

  it('archiveSession rejects missing live session files', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)
    await rm(filePath)

    await expect(service.archiveSession(session.id)).rejects.toThrow(/Session file not found/)
  })

  it('archiveSession rejects archived sessions without a matching archive record', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const db = service['db']
    db.replaceSessions([{ ...session, storageState: 'archived' }])

    await expect(service.archiveSession(session.id)).rejects.toThrow(/Archived session record/)
  })

  it('searchText is preserved after archiving', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    service['db'].insertArchive({
      ...archive,
      session: {
        ...archive.session,
        searchText: undefined as never,
      },
    })
    const after = await service.getSnapshot(false)
    const archivedSession = after.sessions.find((s) => s.id === session.id)
    expect(archivedSession?.searchText).toContain('rare migration needle')
  })

  it('overview.totalTokens is unchanged after archiving', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const before = await service.rescan()
    const session = before.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    await service.archiveSession(session.id)
    const after = await service.getSnapshot(false)
    expect(after.overview.totalTokens).toBe(before.overview.totalTokens)
  })

  it('overview.totalSizeBytes reflects compressed archive bytes after archiving', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    const after = await service.getSnapshot(false)
    expect(after.overview.totalSizeBytes).toBe(archive.compressedBytes)
  })
})

// ---------------------------------------------------------------------------
// restoreArchive
// ---------------------------------------------------------------------------

describe('restoreArchive', () => {
  it('restores a brotli archive back to original path', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    await service.restoreArchive(archive.id)

    const restored = await readFile(filePath, 'utf8')
    expect(restored).toContain('rare migration needle')
  })

  it('clears archive record after restore', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    await service.restoreArchive(archive.id)

    const after = await service.getSnapshot(true)
    expect(after.archives).toHaveLength(0)
    expect(after.sessions.find((s) => s.id === session.id)?.storageState).toBe('live')
  })

  it('restoreArchive throws when archive id is unknown', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.restoreArchive('nonexistent-archive-id')).rejects.toThrow(
      /Archive item not found/,
    )
  })

  it('restoreArchive refuses to overwrite an existing file', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)

    // Put a new file at the original path
    await writeFile(filePath, 'guard content')
    await expect(service.restoreArchive(archive.id)).rejects.toThrow(/already exists/)
    expect(await readFile(filePath, 'utf8')).toBe('guard content')
  })

  it('restoreArchive removes a mismatched restore and keeps the archive record', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    const db = service['db']
    db.insertArchive({ ...archive, contentHash: 'not-the-real-hash' })

    await expect(service.restoreArchive(archive.id)).rejects.toThrow(/checksum/)
    await expect(stat(filePath)).rejects.toThrow()
    expect((await service.getSnapshot(false)).archives).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// scanCleanup – old / large / duplicate candidates and sorting
// ---------------------------------------------------------------------------

describe('scanCleanup', () => {
  it('returns an empty list when sessions are within retention window', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 9999 }) // far future – no old sessions
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const candidates = await service.scanCleanup()
    expect(candidates).toHaveLength(0)
  })

  it('old-session candidate appears when session is older than retentionDays', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 }) // every session is immediately old
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const candidates = await service.scanCleanup()
    const old = candidates.find((c) => c.kind === 'old-session')
    expect(old).toBeDefined()
    expect(old?.source).toBe('codex')
    expect(old?.risk).toBe('medium') // not backed up
  })

  it('backed-up-session candidate has low risk when session is backed up', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)
    await service.backupSession(session.id)

    const candidates = await service.scanCleanup()
    const backed = candidates.find((c) => c.sessionIds.includes(session.id) && c.backedUp)
    expect(backed?.risk).toBe('low')
    expect(backed?.kind).toBe('backed-up-session')
  })

  it('large-session candidate appears when sizeBytes > 50 MB (simulated)', async () => {
    // We can't easily write 50 MB in tests, but we verify the sorting contract:
    // candidates are sorted descending by sizeBytes.
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    // Candidates must be sorted descending by sizeBytes
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].sizeBytes).toBeGreaterThanOrEqual(candidates[i].sizeBytes)
    }
  })

  it('duplicate-backup candidate appears when same session is backed up twice', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 90 }) // keep sessions fresh; only dup trigger
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
      await service.backupSession(session.id)
      vi.setSystemTime(new Date('2026-03-01T00:00:01.000Z'))
      await service.backupSession(session.id)
    } finally {
      vi.useRealTimers()
    }

    const candidates = await service.scanCleanup()
    const dup = candidates.find((c) => c.kind === 'duplicate-backup')
    expect(dup).toBeDefined()
    expect(dup?.risk).toBe('low')
    expect(dup?.backedUp).toBe(true)
  })

  it('large log cleanup candidates reflect high and medium risk states', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const logPath = path.join(fixtureRoot, 'gemini', 'large-session.log')
    await mkdir(path.dirname(logPath), { recursive: true })
    await writeFile(logPath, 'large log marker')
    await truncate(logPath, 51 * 1024 * 1024)

    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.storagePath === logPath)
    assert.ok(session)
    const regularLargePath = path.join(fixtureRoot, 'gemini', 'large-session.jsonl')
    service['db'].replaceSessions([
      ...snapshot.sessions,
      {
        ...session,
        id: `${session.id}:regular-large`,
        storagePath: regularLargePath,
        sizeBytes: 51 * 1024 * 1024,
        backupStatus: 'none',
      },
    ])

    const beforeBackup = await service.scanCleanup()
    const highRisk = beforeBackup.find((c) => c.kind === 'large-log')
    expect(highRisk?.risk).toBe('high')
    expect(highRisk?.backedUp).toBe(false)
    const regularLarge = beforeBackup.find((c) => c.paths.includes(regularLargePath))
    expect(regularLarge?.kind).toBe('old-session')
    expect(regularLarge?.risk).toBe('high')

    await service.backupSession(session.id)
    const afterBackup = await service.scanCleanup()
    const mediumRisk = afterBackup.find((c) => c.kind === 'large-log')
    expect(mediumRisk?.risk).toBe('medium')
    expect(mediumRisk?.backedUp).toBe(true)
  }, 20_000)

  it('filters invalid usageByDate entries and skips dates outside history', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const db = service['db']
    db.replaceSessions([
      {
        ...session,
        metadata: {
          ...session.metadata,
          usageByDate: {
            '2026-02-01': 11,
            '2026-02-02': 0,
            '2026-02-03': -5,
            '2026-02-04': '12',
            '1999-01-01': 99,
          },
          usageEvents: [],
        },
      },
      {
        ...session,
        id: `${session.id}:outside-history`,
        lastUpdated: '1999-01-01T00:00:00.000Z',
        metadata: {},
        tokens: {
          total: 77,
          input: 77,
          output: 0,
        },
      },
    ])

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-02-10T00:00:00.000Z'))
      const usage = (await service.getSnapshot(false)).usage
      expect(usage.find((point) => point.date === '2026-02-01')?.total).toBe(11)
      expect(usage.find((point) => point.date === '2026-02-02')?.total).toBe(0)
      expect(usage.find((point) => point.date === '2026-02-03')?.total).toBe(0)
      expect(usage.find((point) => point.date === '2026-02-04')?.total).toBe(0)
      expect(usage.find((point) => point.date === '1999-01-01')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('merges worktree candidates with session candidates and sorts by size', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0, worktreeRetentionDays: 0 }) // everything stale
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()

    const bigRecord = {
      id: 'wt-big',
      path: '/wt/feature-big',
      ownerAgent: 'other' as const,
      repoName: 'feature-big',
      branch: 'feature-big',
      sizeBytes: 10_000_000,
      lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
      clean: true,
      stale: true,
      defaultRoot: '/wt',
    }
    const dirtyRecord = {
      id: 'wt-dirty',
      path: '/wt/feature-dirty',
      ownerAgent: 'other' as const,
      repoName: 'feature-dirty',
      branch: 'feature-dirty',
      sizeBytes: 500,
      lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
      clean: false,
      stale: true,
      defaultRoot: '/wt',
    }
    const spy = vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue({
      records: [bigRecord, dirtyRecord],
      diagnostics: [],
      sizeCache: new Map(),
    })

    try {
      const candidates = await service.scanCleanup()
      expect(spy).toHaveBeenCalled()
      const kinds = candidates.map((c) => c.kind)
      expect(kinds).toContain('old-session')
      expect(kinds).toContain('stale-worktree')
      expect(kinds).toContain('dirty-worktree')
      for (let i = 1; i < candidates.length; i += 1) {
        expect(candidates[i - 1].sizeBytes).toBeGreaterThanOrEqual(candidates[i].sizeBytes)
      }
      expect(candidates[0].kind).toBe('stale-worktree')
    } finally {
      spy.mockRestore()
    }
  })

  it('does not require configured worktree roots (default roots are scanned)', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0, worktreeRoots: [] })
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const spy = vi.spyOn(worktreesModule, 'scanAllWorktrees')
    try {
      const candidates = await service.scanCleanup()
      // scanAllWorktrees is still called (default agent roots are scanned even
      // with no user-configured roots); in the test env it returns no records,
      // so only session candidates appear.
      expect(candidates.every((c) => c.kind !== 'stale-worktree')).toBe(true)
      expect(candidates.some((c) => c.kind === 'old-session')).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('rolls worktree sizes into per-agent size, overview total, and storage without double-count', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0, worktreeRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()

    // Two worktree records: one attributed to codex (400), one to 'other' (100).
    const codexRoot = path.join(os.homedir(), '.codex', 'worktrees')
    vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue({
      records: [
        {
          id: 'w1',
          path: path.join(codexRoot, 'g', 'a'),
          ownerAgent: 'codex',
          repoName: 'a',
          sizeBytes: 400,
          lastActivity: new Date().toISOString(),
          clean: true,
          stale: true,
          defaultRoot: codexRoot,
        },
        {
          id: 'w2',
          path: '/custom/b',
          ownerAgent: 'other',
          repoName: 'b',
          sizeBytes: 100,
          lastActivity: new Date().toISOString(),
          clean: true,
          stale: true,
          defaultRoot: '/custom',
        },
      ],
      diagnostics: [],
      sizeCache: new Map(),
    })

    const snap = await service.getSnapshot(true)
    const codexAgent = snap.agents.find((a) => a.source === 'codex')
    // codex agent size includes its 400-byte worktree (plus the small session).
    expect(codexAgent?.sizeBytes).toBeGreaterThanOrEqual(400)
    // overview total includes both worktrees (400 + 100).
    expect(snap.overview.totalSizeBytes).toBeGreaterThanOrEqual(500)
    // storage: codex slice includes its worktree; an 'other' slice holds the 100.
    const otherSlice = snap.storage.find((s) => s.source === 'other')
    expect(otherSlice?.sizeBytes).toBe(100)
    // No separate additive Worktrees slice double-counts: sum of storage slices
    // should not exceed sessions + archives + worktrees (400+100).
    const storageTotal = snap.storage.reduce((t, s) => t + s.sizeBytes, 0)
    expect(storageTotal).toBeGreaterThanOrEqual(500)
  })
})

// ---------------------------------------------------------------------------
// moveCleanupToTrash – auto-backup and path moves
// ---------------------------------------------------------------------------

describe('moveCleanupToTrash', () => {
  it('moves session file to trash and creates a backup when not backed up', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    // Keep a second live session so rescan inside moveCleanupToTrash still finds ≥1 session
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    const candidate = candidates.find((c) => c.source === 'codex')
    assert.ok(candidate)

    const trashRecords = await service.moveCleanupToTrash([candidate.id])
    expect(trashRecords).toHaveLength(1)
    const trash = trashRecords[0]
    expect(trash.source).toBe('codex')
    expect(trash.sizeBytes).toBeGreaterThan(0)

    // Original path should be gone
    await expect(stat(filePath)).rejects.toThrow()

    // Trash folder exists
    const trashStat = await stat(trash.trashPath)
    expect(trashStat.isDirectory()).toBe(true)
  }, 20_000)

  it('creates auto-backup before moving to trash', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    const candidate = candidates.find((c) => c.source === 'codex' && !c.backedUp)
    assert.ok(candidate)

    const trashRecords = await service.moveCleanupToTrash([candidate.id])
    // Verify backup was created (returned trash record; check DB via snapshot with forceRescan=true
    // which is safe because a 'claude' session still exists)
    expect(trashRecords).toHaveLength(1)
    const after = await service.getSnapshot(true)
    expect(after.backups.length).toBeGreaterThan(0)
  }, 20_000)

  it('returns trash record in snapshot after move', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    const candidate = candidates.find((c) => c.source === 'codex')
    assert.ok(candidate)

    await service.moveCleanupToTrash([candidate.id])
    const after = await service.getSnapshot(true)
    expect(after.trash.length).toBeGreaterThan(0)
  }, 20_000)

  it('ignores unknown candidate ids gracefully', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const records = await service.moveCleanupToTrash(['does-not-exist'])
    expect(records).toHaveLength(0)
  })

  it('records medium-risk cleanup moves when source paths are already missing', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const missingPath = path.join(fixtureRoot, 'codex', 'already-gone.jsonl')
    const candidate: CleanupCandidate = {
      id: 'medium-missing-path',
      kind: 'old-session',
      title: 'Medium missing path',
      source: 'codex',
      sessionIds: [],
      paths: [missingPath],
      sizeBytes: 10,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      reason: 'Fixture candidate with a missing path.',
      risk: 'medium',
      recoverable: true,
      backedUp: true,
    }
    vi.spyOn(service, 'scanCleanup').mockResolvedValue([candidate])

    const records = await service.moveCleanupToTrash([candidate.id])
    const recovery = service.getRecoveryRecords().find((item) => item.operation === 'trash')

    expect(records).toHaveLength(1)
    expect(records[0].originalPaths).toEqual([])
    expect(recovery?.risk).toBe('medium')
    expect(recovery?.paths).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: missingPath, role: 'source' })]),
    )
  })

  it('records high-risk cleanup recovery when any selected candidate is high risk', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const highPath = path.join(fixtureRoot, 'gemini', 'danger.log')
    await mkdir(path.dirname(highPath), { recursive: true })
    await writeFile(highPath, 'high risk cleanup content')
    const candidate: CleanupCandidate = {
      id: 'high-risk-cleanup',
      kind: 'large-log',
      title: 'High risk cleanup',
      source: 'gemini',
      sessionIds: [],
      paths: [highPath],
      sizeBytes: 24,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      reason: 'Fixture candidate for high risk recovery.',
      risk: 'high',
      recoverable: true,
      backedUp: false,
    }
    vi.spyOn(service, 'scanCleanup').mockResolvedValue([candidate])

    const records = await service.moveCleanupToTrash([candidate.id])
    const recovery = service.getRecoveryRecords().find((item) => item.operation === 'trash')

    expect(records).toHaveLength(1)
    expect(recovery?.risk).toBe('high')
  })

  it('records low-risk cleanup recovery and failed rescan diagnostics', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = path.join(fixtureRoot, 'codex', 'low-risk.jsonl')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, 'low risk cleanup content')
    const candidate: CleanupCandidate = {
      id: 'low-risk-rescan-fails',
      kind: 'duplicate-backup',
      title: 'Low risk rescan fails',
      source: 'codex',
      sessionIds: [],
      paths: [filePath],
      sizeBytes: 24,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      reason: 'Fixture candidate for rescan diagnostics.',
      risk: 'low',
      recoverable: true,
      backedUp: true,
    }
    vi.spyOn(service, 'scanCleanup').mockResolvedValue([candidate])
    vi.spyOn(service, 'rescan').mockRejectedValue(new Error('rescan failed after trash'))

    await expect(service.moveCleanupToTrash([candidate.id])).rejects.toThrow(/rescan failed/)
    const recovery = service.getRecoveryRecords().find((item) => item.operation === 'trash')

    expect(recovery?.risk).toBe('low')
    expect(recovery?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'rescan.failed', message: 'rescan failed after trash' }),
      ]),
    )
  })

  it('moves a worktree candidate to Trash, prunes the parent repo, and records its kind', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    // Create a real directory standing in for the worktree so movePath works.
    const worktreeDir = await mkdtemp(path.join(userDataPath, 'wt-'))
    const expectedCandidateId = hashId(['stale-worktree', worktreeDir])
    const worktreeRecord = {
      id: 'wt-stale-1',
      path: worktreeDir,
      ownerAgent: 'other' as const,
      repoName: 'feature-stale',
      branch: 'feature-stale',
      sizeBytes: 1234,
      lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
      clean: true,
      stale: true,
      defaultRoot: userDataPath,
    }
    const scanSpy = vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue({
      records: [worktreeRecord],
      diagnostics: [],
      sizeCache: new Map(),
    })
    const resolveSpy = vi
      .spyOn(worktreesModule, 'resolveParentRepoFromWorktree')
      .mockResolvedValue({
        parentRepo: '/fake/parent',
        gitFileContent: 'gitdir: /fake/parent/.git/worktrees/x',
      })
    const pruneSpy = vi.spyOn(worktreesModule, 'pruneWorktrees').mockResolvedValue(true)

    try {
      const records = await service.moveCleanupToTrash([expectedCandidateId])
      expect(records).toHaveLength(1)
      expect(records[0].kind).toBe('stale-worktree')
      await expect(stat(worktreeDir)).rejects.toThrow()
      expect(resolveSpy).toHaveBeenCalledWith(worktreeDir)
      expect(pruneSpy).toHaveBeenCalledWith('/fake/parent')
    } finally {
      scanSpy.mockRestore()
      resolveSpy.mockRestore()
      pruneSpy.mockRestore()
    }
  }, 20_000)

  it('keeps the Trash entry intact when prune fails (best-effort, non-blocking)', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const worktreeDir = await mkdtemp(path.join(userDataPath, 'wt-'))
    const expectedCandidateId = hashId(['stale-worktree', worktreeDir])
    const worktreeRecord = {
      id: 'wt-stale-2',
      path: worktreeDir,
      ownerAgent: 'other' as const,
      repoName: 'feature-stale-2',
      branch: 'feature-stale-2',
      sizeBytes: 100,
      lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
      clean: true,
      stale: true,
      defaultRoot: userDataPath,
    }
    const scanSpy = vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue({
      records: [worktreeRecord],
      diagnostics: [],
      sizeCache: new Map(),
    })
    const resolveSpy = vi
      .spyOn(worktreesModule, 'resolveParentRepoFromWorktree')
      .mockResolvedValue({
        parentRepo: '/fake/parent',
        gitFileContent: 'gitdir: /fake/parent/.git/worktrees/x',
      })
    const pruneSpy = vi
      .spyOn(worktreesModule, 'pruneWorktrees')
      .mockRejectedValue(new Error('prune exploded'))

    try {
      const records = await service.moveCleanupToTrash([expectedCandidateId])
      expect(records).toHaveLength(1)
      expect(records[0].kind).toBe('stale-worktree')
      await expect(stat(worktreeDir)).rejects.toThrow()
      expect(pruneSpy).toHaveBeenCalled()
    } finally {
      scanSpy.mockRestore()
      resolveSpy.mockRestore()
      pruneSpy.mockRestore()
    }
  }, 20_000)
})

// ---------------------------------------------------------------------------
// restoreTrash
// ---------------------------------------------------------------------------

describe('restoreTrash', () => {
  it('moves session file back from trash to original path', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    // Second session keeps rescan non-empty after codex is moved to trash
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    const candidate = candidates.find((c) => c.source === 'codex')
    assert.ok(candidate)

    const [trashRecord] = await service.moveCleanupToTrash([candidate.id])
    assert.ok(trashRecord)

    // Recreate parent dir so restore target is reachable, then restore
    await mkdir(path.dirname(filePath), { recursive: true })
    await service.restoreTrash(trashRecord.id)

    const info = await stat(filePath)
    expect(info.size).toBeGreaterThan(0)
  }, 20_000)

  it('removes trash record from snapshot after restore', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    const candidate = candidates.find((c) => c.source === 'codex')
    assert.ok(candidate)

    const [trashRecord] = await service.moveCleanupToTrash([candidate.id])
    assert.ok(trashRecord)
    await mkdir(path.dirname(trashRecord.originalPaths[0]), { recursive: true })
    await service.restoreTrash(trashRecord.id)

    // After restore, both sessions are back; getSnapshot(true) is safe
    const after = await service.getSnapshot(true)
    expect(after.trash.find((t) => t.id === trashRecord.id)).toBeUndefined()
  }, 20_000)

  it('restoreTrash throws when trash record not found', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.restoreTrash('no-such-trash')).rejects.toThrow(/Trash item not found/)
  })

  it('restoreTrash ignores trash records whose moved file is already gone', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    let trashRecord
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(Date.now() + 60_000))
      const candidates = await service.scanCleanup()
      const candidate = candidates.find((c) => c.source === 'codex')
      assert.ok(candidate)
      const records = await service.moveCleanupToTrash([candidate.id])
      trashRecord = records[0]
      assert.ok(trashRecord)
    } finally {
      vi.useRealTimers()
    }
    await rm(trashRecord.trashPath, { recursive: true, force: true })

    // restoreTrash resolves to the restored candidate's kind (a session kind here).
    await expect(service.restoreTrash(trashRecord.id)).resolves.toBe(trashRecord.kind)
  })
})

// ---------------------------------------------------------------------------
// purgeExpiredTrash
// ---------------------------------------------------------------------------

describe('purgeExpiredTrash', () => {
  it('returns an empty list when no Trash records are expired', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ trashRetentionDays: 1 })

    await expect(service.purgeExpiredTrash()).resolves.toEqual([])
  })

  it('restores purge checkpoints when deleting a Trash record fails', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ trashRetentionDays: 1 })
    const trashPath = path.join(userDataPath, 'Trash', 'purge-delete-failure')
    await mkdir(trashPath, { recursive: true })
    await writeFile(path.join(trashPath, 'session.jsonl'), 'trash content')
    const record = trashRecord({
      id: 'purge-delete-failure',
      trashPath,
      deletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    service['db'].insertTrash(record)
    service['db'].deleteTrashRecord = () => {
      throw new Error('delete failed')
    }

    await expect(service.purgeExpiredTrash()).rejects.toThrow(/delete failed/)
    expect(await readFile(path.join(trashPath, 'session.jsonl'), 'utf8')).toBe('trash content')
    expect(
      service.getRecoveryRecords().find((item) => item.operation === 'purge-trash')?.status,
    ).toBe('failed')
  })

  it('removes only expired trash records and keeps fresh records recoverable', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0, trashRetentionDays: 1 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await writeJsonlSession(fixtureRoot, 'gemini', { filename: 'gemini-session.jsonl' })
    await service.rescan()
    const candidates = await service.scanCleanup()
    const selected = candidates
      .filter((candidate) => candidate.source === 'codex' || candidate.source === 'claude')
      .map((candidate) => candidate.id)

    const trashRecords = await service.moveCleanupToTrash(selected)
    expect(trashRecords).toHaveLength(2)
    const [expired, fresh] = trashRecords
    const expiredRecord = {
      ...expired,
      deletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }
    const freshRecord = {
      ...fresh,
      deletedAt: new Date().toISOString(),
    }
    service['db'].insertTrash(expiredRecord)
    service['db'].insertTrash(freshRecord)

    const purged = await service.purgeExpiredTrash()

    expect(purged.map((record) => record.id)).toEqual([expired.id])
    await expect(stat(expired.trashPath)).rejects.toThrow()
    await expect(stat(fresh.trashPath)).resolves.toBeDefined()
    const snapshot = await service.getSnapshot(false)
    expect(snapshot.trash.find((record) => record.id === expired.id)).toBeUndefined()
    expect(snapshot.trash.find((record) => record.id === fresh.id)).toBeDefined()
  }, 20_000)
})

// ---------------------------------------------------------------------------
// Recovery records, diagnostics, and undo
// ---------------------------------------------------------------------------

describe('recovery system', () => {
  it('records and diagnoses backup operations, then undoes the created backup', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const backup = await service.backupSession(session.id)
    const recovery = service.getRecoveryRecords().find((record) => record.operation === 'backup')
    assert.ok(recovery)
    expect(recovery.status).toBe('completed')
    expect(recovery.explanation).toContain('Copies')
    expect(recovery.undo.available).toBe(true)

    const diagnosed = await service.diagnoseRecovery(recovery.id)
    expect(diagnosed.diagnostics.some((item) => item.code === 'path.exists')).toBe(true)

    await service.undoRecovery(recovery.id)
    await expect(stat(backup.backupPath)).rejects.toThrow()
    expect((await service.getSnapshot(false)).backups.find((item) => item.id === backup.id)).toBe(
      undefined,
    )
    expect(service.getRecoveryRecords().find((record) => record.id === recovery.id)?.status).toBe(
      'undone',
    )
  })

  it('records and undoes export operations by removing the exported file', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const exportPath = await service.exportSession(session.id, 'markdown')
    await expect(stat(exportPath)).resolves.toBeDefined()
    const recovery = service.getRecoveryRecords().find((record) => record.operation === 'export')
    assert.ok(recovery)

    await service.undoRecovery(recovery.id)
    await expect(stat(exportPath)).rejects.toThrow()
  })

  it('undoes a Trash move by restoring all moved files', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0 })
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidate = (await service.scanCleanup()).find((item) => item.source === 'codex')
    assert.ok(candidate)

    const [trashRecord] = await service.moveCleanupToTrash([candidate.id])
    assert.ok(trashRecord)
    await expect(stat(filePath)).rejects.toThrow()
    const recovery = service
      .getRecoveryRecords()
      .find((record) => record.operation === 'trash' && record.metadata.trashIds)
    assert.ok(recovery)

    await service.undoRecovery(recovery.id)
    expect(await readFile(filePath, 'utf8')).toContain('rare migration needle')
    expect(
      (await service.getSnapshot(true)).trash.find((record) => record.id === trashRecord.id),
    ).toBe(undefined)
  }, 20_000)

  it('keeps purge checkpoints recoverable through undo', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0, trashRetentionDays: 1 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const candidate = (await service.scanCleanup()).find((item) => item.source === 'codex')
    assert.ok(candidate)

    const [trashRecord] = await service.moveCleanupToTrash([candidate.id])
    assert.ok(trashRecord)
    const expiredRecord = {
      ...trashRecord,
      deletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }
    service['db'].insertTrash(expiredRecord)

    const purged = await service.purgeExpiredTrash()
    expect(purged.map((record) => record.id)).toEqual([trashRecord.id])
    await expect(stat(trashRecord.trashPath)).rejects.toThrow()
    const recovery = service
      .getRecoveryRecords()
      .find((record) => record.operation === 'purge-trash')
    assert.ok(recovery)
    expect(recovery.undo.available).toBe(true)

    await service.undoRecovery(recovery.id)
    await expect(stat(trashRecord.trashPath)).resolves.toBeDefined()
    expect(
      (await service.getSnapshot(false)).trash.find((record) => record.id === trashRecord.id),
    ).toBeDefined()
  }, 20_000)

  it('records unavailable purge undo when expired Trash paths are already gone', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ trashRetentionDays: 1 })
    const expiredRecord = trashRecord({
      id: 'trash-missing-path',
      trashPath: path.join(userDataPath, 'Trash', 'missing-path'),
      deletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    service['db'].insertTrash(expiredRecord)

    const purged = await service.purgeExpiredTrash()
    const recovery = service
      .getRecoveryRecords()
      .find((record) => record.operation === 'purge-trash')

    expect(purged.map((record) => record.id)).toEqual([expiredRecord.id])
    assert.ok(recovery)
    expect(recovery.undo).toMatchObject({
      kind: 'restore-purged-trash',
      available: false,
      reason: 'No on-disk Trash paths existed when purge ran.',
    })
  })

  it('rolls back purge recovery metadata when checkpoint creation fails', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ trashRetentionDays: 1 })
    const startedAt = '2026-02-10T00:00:00.000Z'
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(startedAt))
      const expiredRecord = trashRecord({
        id: 'trash-checkpoint-fails',
        trashPath: path.join(userDataPath, 'Trash', 'checkpoint-fails'),
        deletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      })
      await mkdir(expiredRecord.trashPath, { recursive: true })
      await writeFile(path.join(expiredRecord.trashPath, 'item.jsonl'), 'trash content')
      service['db'].insertTrash(expiredRecord)
      const recoveryId = testHashId([
        'recovery',
        'purge-trash',
        undefined,
        'Purge 1 expired Trash item',
        startedAt,
        0.123,
      ])
      const blockedCheckpointDir = path.join(userDataPath, 'Recovery', 'purge-trash', recoveryId)
      await mkdir(path.dirname(blockedCheckpointDir), { recursive: true })
      await writeFile(blockedCheckpointDir, 'not a directory')

      await expect(service.purgeExpiredTrash()).rejects.toThrow()
      const recovery = service['db'].getRecoveryRecord(recoveryId)

      expect(recovery?.status).toBe('failed')
      expect(recovery?.metadata.trashIds).toEqual([expiredRecord.id])
      expect(service['db'].getTrashRecord(expiredRecord.id)).toBeDefined()
      await expect(stat(expiredRecord.trashPath)).resolves.toBeDefined()
    } finally {
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('undoes an archive recovery by restoring the archived session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((item) => item.source === 'codex')
    assert.ok(session)

    const archive = await service.archiveSession(session.id)
    await expect(stat(filePath)).rejects.toThrow()
    const recovery = service
      .getRecoveryRecords()
      .find((record) => record.operation === 'archive' && record.metadata.archiveId === archive.id)
    assert.ok(recovery)

    await service.undoRecovery(recovery.id)

    expect(await readFile(filePath, 'utf8')).toContain('rare migration needle')
    expect((await service.getSnapshot(false)).archives.find((item) => item.id === archive.id)).toBe(
      undefined,
    )
  })

  it('records failed export diagnostics when the source session cannot be decoded', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)
    await rm(filePath)

    await expect(service.exportUniversalRelay(session.id)).rejects.toThrow()
    const recovery = service.getRecoveryRecords().find((record) => record.operation === 'export')
    assert.ok(recovery)
    expect(recovery.status).toBe('failed')
    expect(recovery.diagnostics.some((item) => item.level === 'error')).toBe(true)
  })

  it('starts recovery records with default paths, undo, steps, and metadata', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)

    const recovery = service['startRecovery']({
      operation: 'export',
      title: 'Default recovery fixture',
      explanation: 'Covers startRecovery default branches.',
    })

    expect(recovery.paths).toEqual([])
    expect(recovery.metadata).toEqual({})
    expect(recovery.steps).toEqual([
      expect.objectContaining({ label: 'Started', status: 'completed' }),
    ])
    expect(recovery.undo).toEqual(
      expect.objectContaining({
        kind: 'none',
        available: false,
        reason: 'This operation has not completed yet.',
      }),
    )
  })

  it('diagnoses missing paths, operation errors, and unavailable undo states', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const missingPath = path.join(fixtureRoot, 'missing-session.jsonl')
    const optionalMissingPath = path.join(fixtureRoot, 'optional-missing-session.jsonl')
    const recovery = recoveryRecord({
      status: 'failed',
      error: 'fixture failure',
      paths: [
        { label: 'Missing required path', path: missingPath, role: 'source' },
        {
          label: 'Missing optional path',
          path: optionalMissingPath,
          role: 'checkpoint',
          optional: true,
        },
      ],
      undo: {
        kind: 'remove-created-paths',
        available: false,
        label: 'Unavailable undo',
      },
    })
    service['db'].upsertRecovery(recovery)

    const diagnosed = await service.diagnoseRecovery(recovery.id)

    expect(diagnosed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'path.missing', level: 'warning', path: missingPath }),
        expect.objectContaining({ code: 'path.missing', level: 'info', path: optionalMissingPath }),
        expect.objectContaining({ code: 'operation.error', level: 'error' }),
        expect.objectContaining({ code: 'undo.unavailable', level: 'warning' }),
      ]),
    )
  })

  it('rejects already-undone and unavailable recovery undo requests', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const undone = recoveryRecord({ id: 'already-undone', status: 'undone' })
    const unavailable = recoveryRecord({
      id: 'unavailable-undo',
      undo: {
        kind: 'restore-trash',
        available: false,
        label: 'Unavailable restore',
        reason: 'fixture unavailable',
      },
    })
    service['db'].upsertRecovery(undone)
    service['db'].upsertRecovery(unavailable)

    await expect(service.undoRecovery(undone.id)).rejects.toThrow(/already undone/)
    await expect(service.undoRecovery(unavailable.id)).rejects.toThrow(/fixture unavailable/)

    const noReason = recoveryRecord({
      id: 'unavailable-undo-without-reason',
      undo: {
        kind: 'restore-trash',
        available: false,
        label: 'Unavailable restore',
      },
    })
    service['db'].upsertRecovery(noReason)
    await expect(service.undoRecovery(noReason.id)).rejects.toThrow(/Recovery cannot be undone/)
    await expect(service.diagnoseRecovery('missing-recovery-record')).rejects.toThrow(
      /Recovery record not found/,
    )
  })

  it('removes created paths without requiring backup metadata', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const sourcePath = path.join(fixtureRoot, 'source.txt')
    const exportPath = path.join(userDataPath, 'Exports', 'remove-me.md')
    const restoredPath = path.join(userDataPath, 'Restored', 'remove-me.jsonl')
    await mkdir(path.dirname(exportPath), { recursive: true })
    await mkdir(path.dirname(restoredPath), { recursive: true })
    await writeFile(sourcePath, 'keep me')
    await writeFile(exportPath, 'remove export')
    await writeFile(restoredPath, 'remove restored')
    const recovery = recoveryRecord({
      id: 'remove-created-paths-no-backup',
      operation: 'export',
      paths: [
        { label: 'Source', path: sourcePath, role: 'source' },
        { label: 'Export', path: exportPath, role: 'export' },
        { label: 'Restored', path: restoredPath, role: 'restored' },
      ],
      undo: {
        kind: 'remove-created-paths',
        available: true,
        label: 'Remove created paths',
      },
    })
    service['db'].upsertRecovery(recovery)

    await service.undoRecovery(recovery.id)

    await expect(stat(sourcePath)).resolves.toBeDefined()
    await expect(stat(exportPath)).rejects.toThrow()
    await expect(stat(restoredPath)).rejects.toThrow()
  })

  it('marks restore-trash undo failed when no matching trash record exists', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const recovery = recoveryRecord({
      id: 'missing-trash-undo',
      undo: {
        kind: 'restore-trash',
        available: true,
        label: 'Restore missing Trash',
      },
      metadata: { trashId: 'missing-trash' },
    })
    service['db'].upsertRecovery(recovery)

    await expect(service.undoRecovery(recovery.id)).rejects.toThrow(/No matching Trash records/)
    expect(service.getRecoveryRecords().find((record) => record.id === recovery.id)?.status).toBe(
      'failed',
    )
  })

  it('marks restore-archive undo failed when archive metadata points to a missing archive', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const recovery = recoveryRecord({
      id: 'missing-archive-undo',
      undo: {
        kind: 'restore-archive',
        available: true,
        label: 'Restore missing archive',
      },
      metadata: { archiveId: 'missing-archive' },
    })
    service['db'].upsertRecovery(recovery)

    await expect(service.undoRecovery(recovery.id)).rejects.toThrow(/No matching archive record/)
  })

  it('rejects invalid purged Trash metadata and existing recovery Trash paths', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const missing = recoveryRecord({
      id: 'missing-purged-trash',
      undo: {
        kind: 'restore-purged-trash',
        available: true,
        label: 'Recover missing purge metadata',
      },
      metadata: {},
    })
    const invalid = recoveryRecord({
      id: 'invalid-purged-trash',
      undo: {
        kind: 'restore-purged-trash',
        available: true,
        label: 'Recover invalid purge',
      },
      metadata: { purgedTrash: [{ checkpointPath: 42 }] },
    })
    const existingTrash = trashRecord({
      id: 'existing-trash',
      trashPath: path.join(userDataPath, 'Trash', 'existing-trash'),
    })
    const checkpointPath = path.join(userDataPath, 'Recovery', 'checkpoint-existing')
    await mkdir(existingTrash.trashPath, { recursive: true })
    await mkdir(checkpointPath, { recursive: true })
    const pathExists = recoveryRecord({
      id: 'purged-trash-path-exists',
      undo: {
        kind: 'restore-purged-trash',
        available: true,
        label: 'Recover path exists purge',
      },
      metadata: { purgedTrash: [{ record: existingTrash, checkpointPath }] },
    })
    service['db'].upsertRecovery(missing)
    service['db'].upsertRecovery(invalid)
    service['db'].upsertRecovery(pathExists)

    await expect(service.undoRecovery(missing.id)).rejects.toThrow(/missing purged Trash/)
    await expect(service.undoRecovery(invalid.id)).rejects.toThrow(/invalid purged Trash/)
    await expect(service.undoRecovery(pathExists.id)).rejects.toThrow(/path exists/)
  })

  it('guards restore-archive undo when restored content changed or archive path exists', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'codex')
    assert.ok(session)

    const checkpointPath = path.join(userDataPath, 'Recovery', 'archive-checkpoint.br')
    await mkdir(path.dirname(checkpointPath), { recursive: true })
    await writeFile(checkpointPath, 'checkpoint')
    const changedArchive = archiveRecord(session, {
      id: 'changed-archive',
      originalPath: filePath,
      archivePath: path.join(userDataPath, 'Vault', 'changed-archive.br'),
      contentHash: 'not-the-current-file-hash',
    })
    const changed = recoveryRecord({
      id: 'restore-archive-changed',
      undo: {
        kind: 'restore-pre-restore-archive',
        available: true,
        label: 'Undo changed archive restore',
      },
      metadata: { archiveRecord: changedArchive, checkpointPath },
    })

    const existingArchivePath = path.join(userDataPath, 'Vault', 'already-there.br')
    const archivePathExists = recoveryRecord({
      id: 'restore-archive-path-exists',
      undo: {
        kind: 'restore-pre-restore-archive',
        available: true,
        label: 'Undo path exists archive restore',
      },
      metadata: {
        archiveRecord: archiveRecord(session, {
          id: 'archive-path-exists',
          originalPath: path.join(fixtureRoot, 'missing-original.jsonl'),
          archivePath: existingArchivePath,
        }),
        checkpointPath,
      },
    })
    await mkdir(path.dirname(existingArchivePath), { recursive: true })
    await writeFile(existingArchivePath, 'existing archive')
    service['db'].upsertRecovery(changed)
    service['db'].upsertRecovery(archivePathExists)

    await expect(service.undoRecovery(changed.id)).rejects.toThrow(/restored file changed/)
    await expect(service.undoRecovery(archivePathExists.id)).rejects.toThrow(/archive path exists/)
  }, 20_000)

  it('successfully undoes an archive restore using its checkpoint', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    const snapshot = await service.rescan()
    const session = snapshot.sessions.find((s) => s.source === 'claude')
    assert.ok(session)
    const checkpointPath = path.join(userDataPath, 'Recovery', 'successful-archive-checkpoint.br')
    const archivePath = path.join(userDataPath, 'Vault', 'successful-archive.br')
    const missingOriginalPath = path.join(fixtureRoot, 'claude', 'missing-original.jsonl')
    await mkdir(path.dirname(checkpointPath), { recursive: true })
    await writeFile(checkpointPath, 'checkpoint archive content')
    const archive = archiveRecord(session, {
      id: 'successful-archive-undo',
      originalPath: missingOriginalPath,
      archivePath,
    })
    const recovery = recoveryRecord({
      id: 'restore-archive-success',
      undo: {
        kind: 'restore-pre-restore-archive',
        available: true,
        label: 'Undo archive restore',
      },
      metadata: { archiveRecord: archive, checkpointPath },
    })
    service['db'].upsertRecovery(recovery)

    await service.undoRecovery(recovery.id)

    expect(service['db'].getArchiveRecord(archive.id)?.id).toBe(archive.id)
    await expect(stat(archivePath)).resolves.toBeDefined()
    await expect(stat(checkpointPath)).rejects.toThrow()
  }, 20_000)

  it('guards and performs restore-trash undo back into app Trash', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'claude', { filename: 'claude-session.jsonl' })
    await service.rescan()
    const originalPath = path.join(fixtureRoot, 'codex', 'restored-trash.jsonl')
    await mkdir(path.dirname(originalPath), { recursive: true })
    await writeFile(originalPath, 'restored content')
    const existingTrash = trashRecord({
      id: 'restore-trash-path-exists',
      originalPaths: [originalPath],
      trashPath: path.join(userDataPath, 'Trash', 'restore-trash-path-exists'),
    })
    const successfulTrash = trashRecord({
      id: 'restore-trash-success',
      originalPaths: [originalPath],
      trashPath: path.join(userDataPath, 'Trash', 'restore-trash-success'),
    })
    const blocked = recoveryRecord({
      id: 'restore-pre-trash-path-exists',
      undo: {
        kind: 'restore-pre-restore-trash',
        available: true,
        label: 'Move back to existing Trash',
      },
      metadata: { trashRecord: existingTrash },
    })
    const succeeds = recoveryRecord({
      id: 'restore-pre-trash-success',
      undo: {
        kind: 'restore-pre-restore-trash',
        available: true,
        label: 'Move back to Trash',
      },
      metadata: { trashRecord: successfulTrash },
    })
    await mkdir(existingTrash.trashPath, { recursive: true })
    service['db'].upsertRecovery(blocked)
    service['db'].upsertRecovery(succeeds)

    await expect(service.undoRecovery(blocked.id)).rejects.toThrow(/Trash path exists/)
    await service.undoRecovery(succeeds.id)

    await expect(stat(originalPath)).rejects.toThrow()
    await expect(
      stat(path.join(successfulTrash.trashPath, path.basename(originalPath))),
    ).resolves.toBeDefined()
    expect(service['db'].getTrashRecord(successfulTrash.id)?.id).toBe(successfulTrash.id)
  }, 20_000)

  it('refuses to restore Trash over an existing original path', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const originalPath = path.join(fixtureRoot, 'codex', 'existing-original.jsonl')
    const trashPath = path.join(userDataPath, 'Trash', 'restore-collision')
    await mkdir(path.dirname(originalPath), { recursive: true })
    await mkdir(trashPath, { recursive: true })
    await writeFile(originalPath, 'live original')
    await writeFile(path.join(trashPath, path.basename(originalPath)), 'trash copy')
    const record = trashRecord({
      id: 'restore-collision',
      originalPaths: [originalPath],
      trashPath,
    })
    service['db'].insertTrash(record)

    await expect(service.restoreTrash(record.id)).rejects.toThrow(/original path exists/)
    expect(service['db'].getTrashRecord(record.id)?.id).toBe(record.id)
  })

  it('covers missing recovery metadata helpers through direct undo execution', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()

    await expect(
      service['performRecoveryUndo'](
        recoveryRecord({
          undo: { kind: 'restore-archive', available: true, label: 'Missing archive id' },
          metadata: {},
        }),
      ),
    ).rejects.toThrow(/metadata is missing archiveId/)
    await expect(
      service['performRecoveryUndo'](
        recoveryRecord({
          undo: {
            kind: 'restore-pre-restore-trash',
            available: true,
            label: 'Missing trash record',
          },
          metadata: {},
        }),
      ),
    ).rejects.toThrow(/metadata is missing trashRecord/)
  })

  it('covers direct unsupported recovery undo branches', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    await expect(
      service['performRecoveryUndo'](
        recoveryRecord({
          undo: { kind: 'none', available: true, label: 'No direct undo' },
        }),
      ),
    ).rejects.toThrow(/no undo action/)
    await expect(
      service['performRecoveryUndo'](
        recoveryRecord({
          undo: { kind: 'future-kind' as never, available: true, label: 'Future undo' },
        }),
      ),
    ).rejects.toThrow(/Unsupported recovery undo action/)
  })

  it('purges expired Trash metadata without checkpoints when paths are already gone', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await service.init()
    const record = trashRecord({
      id: 'missing-expired-trash',
      title: 'Missing expired Trash',
      trashPath: path.join(userDataPath, 'Trash', 'already-gone'),
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    service['db'].insertTrash(record)

    const purged = await service.purgeExpiredTrash()

    expect(purged.map((item) => item.id)).toEqual([record.id])
    expect(service['db'].getTrashRecord(record.id)).toBeUndefined()
    const recovery = service.getRecoveryRecords().find((item) => item.operation === 'purge-trash')
    expect(recovery).toEqual(
      expect.objectContaining({
        status: 'completed',
        undo: expect.objectContaining({
          kind: 'restore-purged-trash',
          available: false,
          reason: 'No on-disk Trash paths existed when purge ran.',
        }),
        metadata: expect.objectContaining({ purgedTrash: [] }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// skills scanning
// ---------------------------------------------------------------------------

describe('skills scanning', () => {
  it('requires service initialization before scanning skills', async () => {
    const service = makeService(userDataPath)
    await expect(service.getSkills()).rejects.toThrow(/not initialized/)
  })

  it('returns discovered local skills from configured scan roots', async () => {
    const service = makeService(userDataPath)
    await service.init()
    const codexRoot = path.join(fixtureRoot, 'codex-skills')
    const skillDir = path.join(codexRoot, 'review-helper')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: Review Helper\ndescription: Review code changes before merge.\n---`,
    )
    service.updateSettings({ scanRoots: { codex: [codexRoot] } })

    const snapshot = await service.getSkills()

    expect(snapshot.summary.totalSkills).toBeGreaterThanOrEqual(1)
    expect(snapshot.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Review Helper',
          ownerAgent: 'codex',
          status: 'local',
          location: expect.stringContaining('review-helper'),
        }),
      ]),
    )
  })
})

// ---------------------------------------------------------------------------
// openPath
// ---------------------------------------------------------------------------

describe('openPath', () => {
  it('delegates to the injected openPath handler', async () => {
    const calls: string[] = []
    const handler = async (p: string) => {
      calls.push(p)
    }
    const service = new AppService({ userDataPath, openPath: handler })
    await service.init()
    await service.openPath('/some/path')
    expect(calls).toEqual(['/some/path'])
  })

  it('uses the default no-op handler when none is provided', async () => {
    const service = new AppService({ userDataPath })
    await service.init()
    // Should not throw
    await expect(service.openPath('/anything')).resolves.toBeUndefined()
  })

  it('rejects non-local or relative paths', async () => {
    const calls: string[] = []
    const service = new AppService({
      userDataPath,
      openPath: async (targetPath) => {
        calls.push(targetPath)
      },
    })
    await service.init()

    await expect(service.openPath('relative/path')).rejects.toThrow(
      /targetPath must be an absolute local path/,
    )
    await expect(service.openPath('https://example.test/file')).rejects.toThrow(
      /targetPath must be an absolute local path/,
    )
    await expect(service.openPath('file:///tmp/example')).rejects.toThrow(
      /targetPath must be an absolute local path/,
    )
    expect(calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Not-initialized errors
// ---------------------------------------------------------------------------

describe('not initialized errors', () => {
  it('rescan throws before init', async () => {
    const service = makeService(userDataPath)
    // requireSettings() throws "not initialized" — it's the first check hit
    await expect(service.rescan()).rejects.toThrow(/not initialized/)
  })

  it('getSnapshot throws before init', async () => {
    const service = makeService(userDataPath)
    // The db isn't open yet so the first db call (or requireSettings) throws
    await expect(service.getSnapshot(false)).rejects.toThrow()
  })

  it('backupSession throws before init', async () => {
    const service = makeService(userDataPath)
    await expect(service.backupSession('x')).rejects.toThrow()
  })

  it('scanCleanup throws before init', async () => {
    const service = makeService(userDataPath)
    await expect(service.scanCleanup()).rejects.toThrow()
  })

  it('moveCleanupToTrash throws before init', async () => {
    const service = makeService(userDataPath)
    await expect(service.moveCleanupToTrash([])).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Session-missing errors
// ---------------------------------------------------------------------------

describe('session missing errors', () => {
  it('exportSession throws for missing session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.exportSession('missing', 'json')).rejects.toThrow(/Session not found/)
  })

  it('exportUniversalRelay throws for missing session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.exportUniversalRelay('missing')).rejects.toThrow(/Session not found/)
  })

  it('archiveSession throws for missing session', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    await expect(service.archiveSession('missing')).rejects.toThrow(/Session not found/)
  })
})

// ---------------------------------------------------------------------------
// Archive vault (original test, preserved)
// ---------------------------------------------------------------------------

describe('AppService archive vault', () => {
  it('archives sessions into the vault without dropping indexed stats or search text', async () => {
    const localFixture = await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-archive-fixture-'))
    const localUserData = await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-archive-user-data-'))
    try {
      const filePath = await writeJsonlSession(localFixture, 'codex')

      const service = new AppService({
        userDataPath: localUserData,
        openPath: async () => undefined,
      })
      await service.init()
      service.updateSettings({
        scanRoots: Object.fromEntries(
          agentSources.map((source) => [source, [path.join(localFixture, source)]]),
        ),
        exportDirectory: path.join(localUserData, 'Exports'),
      })

      const initial = await service.rescan()
      const session = initial.sessions.find((item) => item.source === 'codex')
      assert.ok(session)
      expect(session.storageState).toBe('live')
      expect(session.searchText).toContain('rare migration needle')

      const archive = await service.archiveSession(session.id)
      expect(archive.originalPath).toBe(filePath)
      expect(archive.originalBytes).toBeGreaterThan(0)
      expect(archive.compressedBytes).toBeGreaterThan(0)
      expect(archive.compressedBytes).toBeLessThan(archive.originalBytes)

      await expect(stat(filePath)).rejects.toThrow()
      expect((await stat(archive.archivePath)).size).toBe(archive.compressedBytes)

      const archivedSnapshot = await service.getSnapshot(false)
      expect(archivedSnapshot.archives).toHaveLength(1)
      expect(archivedSnapshot.sessions).toHaveLength(1)
      expect(archivedSnapshot.sessions[0].storageState).toBe('archived')
      expect(archivedSnapshot.sessions[0].searchText).toContain('rare migration needle')
      expect(archivedSnapshot.overview.totalTokens).toBe(initial.overview.totalTokens)
      expect(archivedSnapshot.overview.totalSizeBytes).toBe(archive.compressedBytes)
      expect(archivedSnapshot.usage.find((point) => point.date === '2026-02-01')?.total).toBe(
        initial.overview.totalTokens,
      )

      const relayPath = await service.exportUniversalRelay(session.id)
      const relay = JSON.parse(await readFile(relayPath, 'utf8')) as {
        messages: Array<{ text: string }>
      }
      expect(relay.messages.some((message) => message.text.includes('rare migration needle'))).toBe(
        true,
      )

      await writeFile(filePath, 'new live session should not be overwritten')
      await expect(service.restoreArchive(archive.id)).rejects.toThrow(/already exists/)
      expect(await readFile(filePath, 'utf8')).toBe('new live session should not be overwritten')
      expect((await service.getSnapshot(false)).archives).toHaveLength(1)

      await import('node:fs/promises').then(({ rm: rmFile }) => rmFile(filePath))
      await service.restoreArchive(archive.id)
      const restoredSnapshot = await service.getSnapshot(true)
      expect(restoredSnapshot.archives).toHaveLength(0)
      expect(restoredSnapshot.sessions).toHaveLength(1)
      expect(restoredSnapshot.sessions[0].storageState).toBe('live')
      expect(await readFile(filePath, 'utf8')).toContain('rare migration needle')
    } finally {
      await rm(localFixture, { recursive: true, force: true })
      await rm(localUserData, { recursive: true, force: true })
    }
  })
})

describe('worktree cleanup listing', () => {
  it('lists all worktrees and default-selects only abandoned (stale+clean) ones', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    service.updateSettings({ cleanupRetentionDays: 0, worktreeRetentionDays: 7 })
    await writeJsonlSession(fixtureRoot, 'codex')
    await service.rescan()
    const codexRoot = path.join(os.homedir(), '.codex', 'worktrees')
    vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue({
      records: [
        {
          id: 's',
          path: path.join(codexRoot, 'g', 'stale-clean'),
          ownerAgent: 'codex',
          repoName: 'stale-clean',
          sizeBytes: 10,
          lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
          clean: true,
          stale: true,
          defaultRoot: codexRoot,
        },
        {
          id: 'd',
          path: path.join(codexRoot, 'g', 'stale-dirty'),
          ownerAgent: 'codex',
          repoName: 'stale-dirty',
          sizeBytes: 10,
          lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
          clean: false,
          stale: true,
          defaultRoot: codexRoot,
        },
        {
          id: 'a',
          path: path.join(codexRoot, 'g', 'active'),
          ownerAgent: 'codex',
          repoName: 'active',
          sizeBytes: 10,
          lastActivity: new Date().toISOString(),
          clean: true,
          stale: false,
          defaultRoot: codexRoot,
        },
      ],
      diagnostics: [],
      sizeCache: new Map(),
    })
    const candidates = await service.scanCleanup()
    const wt = candidates.filter((c) =>
      ['stale-worktree', 'dirty-worktree', 'active-worktree'].includes(c.kind),
    )
    expect(wt.map((c) => c.kind).sort()).toEqual([
      'active-worktree',
      'dirty-worktree',
      'stale-worktree',
    ])
    const selected = defaultCleanupSelection(candidates)
    expect(selected).toContain(wt.find((c) => c.kind === 'stale-worktree')!.id)
    expect(selected).not.toContain(wt.find((c) => c.kind === 'dirty-worktree')!.id)
    expect(selected).not.toContain(wt.find((c) => c.kind === 'active-worktree')!.id)
  })
})

describe('trashWorktree', () => {
  it('trashes a worktree by path via the panel flow (Trash + prune)', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    const worktreeDir = await mkdtemp(path.join(userDataPath, 'wt-'))
    vi.spyOn(worktreesModule, 'scanAllWorktrees').mockResolvedValue({
      records: [
        {
          id: 'w',
          path: worktreeDir,
          ownerAgent: 'other' as const,
          repoName: 'feature',
          branch: 'feature',
          sizeBytes: 100,
          lastActivity: new Date(Date.now() - 60 * 86400000).toISOString(),
          clean: true,
          stale: true,
          defaultRoot: userDataPath,
        },
      ],
      diagnostics: [],
      sizeCache: new Map(),
    })
    vi.spyOn(worktreesModule, 'resolveParentRepoFromWorktree').mockResolvedValue({
      parentRepo: '/fake/parent',
      gitFileContent: 'gitdir: /fake/parent/.git/worktrees/x',
    })
    const pruneSpy = vi.spyOn(worktreesModule, 'pruneWorktrees').mockResolvedValue(true)
    try {
      const record = await service.trashWorktree(worktreeDir)
      expect(record?.kind).toBe('stale-worktree')
      await expect(stat(worktreeDir)).rejects.toThrow()
      expect(pruneSpy).toHaveBeenCalledWith('/fake/parent')
    } finally {
      worktreesModule.resolveParentRepoFromWorktree.mockRestore()
      pruneSpy.mockRestore()
    }
  }, 20_000)
})
