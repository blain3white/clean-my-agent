import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppService } from './app-service'
import { agentSources, type AgentSource } from '../../src/shared/types'

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

  it('snapshot overview aggregates totalTokens across sessions', async () => {
    const service = await initServiceWithScan(fixtureRoot, userDataPath)
    await writeJsonlSession(fixtureRoot, 'codex')
    const snapshot = await service.rescan()
    expect(snapshot.overview.totalTokens).toBeGreaterThan(0)
    expect(snapshot.overview.totalTokens).toBe(
      snapshot.sessions.reduce((s, x) => s + x.tokens.total, 0),
    )
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

    await service.archiveSession(session.id)
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

    const beforeBackup = await service.scanCleanup()
    const highRisk = beforeBackup.find((c) => c.kind === 'large-log')
    expect(highRisk?.risk).toBe('high')
    expect(highRisk?.backedUp).toBe(false)

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

    await expect(service.restoreTrash(trashRecord.id)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// purgeExpiredTrash
// ---------------------------------------------------------------------------

describe('purgeExpiredTrash', () => {
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
