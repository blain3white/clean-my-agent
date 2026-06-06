import path from 'node:path'
import type {
  AgentSource,
  AppLanguage,
  AgentInstallState,
  ArchiveRecord,
  AppSettings,
  BackupRecord,
  CleanupCandidate,
  DashboardSnapshot,
  ExportFormat,
  SessionRecord,
  StorageSlice,
  TrashRecord,
  UpdateCheckResult,
  UsagePoint,
} from '../../src/shared/types'
import { agentSources, appLanguages, defaultLanguage, exportFormats } from '../../src/shared/types'
import { adapters, adapterFor, enabledProviderSources } from './adapters'
import { LocalDatabase } from './database'
import {
  compressFileBrotli,
  copyPath,
  decompressFileBrotli,
  ensureDir,
  exists,
  expandHome,
  hashFile,
  hashId,
  movePath,
  pathSize,
  removePath,
  sanitizeName,
  writeJson,
} from './files'

const oneDayMs = 24 * 60 * 60 * 1000
const usageHistoryDays = 365
const scanSchemaVersion = 3
const currentAppVersion = process.env.npm_package_version ?? '0.1.1'
const maxPathLength = 4096
const maxRetentionDays = 36_500
const relayModes: AppSettings['defaultRelayMode'][] = [
  'full-context',
  'fit-to-window',
  'manual-select',
]
const agentLabels: Record<AgentSource, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  custom: 'Custom',
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function bytesFromRecords(records: Array<{ sizeBytes: number }>): number {
  return records.reduce((total, record) => total + record.sizeBytes, 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSafePathString(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxPathLength || trimmed.includes('\0')) return false
  if (/^(https?|data|blob|file):/i.test(trimmed)) return false
  return path.isAbsolute(trimmed) || trimmed.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(trimmed)
}

function normalizePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSafePathString(value)) {
    throw new Error(`${label} must be an absolute local path.`)
  }
  return expandHome(value.trim())
}

function validateIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 256 ||
    value.includes('\0') ||
    !/^[\w:./-]+$/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty identifier.`)
  }
  return value
}

function validateIdentifierArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return Array.from(new Set(value.map((item) => validateIdentifier(item, label))))
}

function normalizeDays(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > maxRetentionDays
  ) {
    throw new Error(`${label} must be an integer between 0 and ${maxRetentionDays}.`)
  }
  return value
}

function safeDays(value: unknown, fallback: number): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maxRetentionDays
    ? value
    : fallback
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function safePath(value: unknown, fallback: string): string {
  return typeof value === 'string' && isSafePathString(value) ? expandHome(value.trim()) : fallback
}

function normalizeScanRoots(value: unknown): AppSettings['scanRoots'] | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('scanRoots must be an object.')

  const scanRoots: AppSettings['scanRoots'] = {}
  Object.entries(value).forEach(([source, roots]) => {
    if (!agentSources.includes(source as AgentSource)) {
      throw new Error(`Unsupported scan root source: ${source}`)
    }
    if (!Array.isArray(roots)) throw new Error(`scanRoots.${source} must be an array.`)
    scanRoots[source as AgentSource] = roots.map((root) =>
      normalizePath(root, `scanRoots.${source}`),
    )
  })

  return scanRoots
}

function normalizeEnabledProviders(value: unknown): AppSettings['enabledProviders'] | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('enabledProviders must be an object.')

  const enabledProviders: AppSettings['enabledProviders'] = {}
  Object.entries(value).forEach(([source, enabled]) => {
    if (!agentSources.includes(source as AgentSource)) {
      throw new Error(`Unsupported provider source: ${source}`)
    }
    if (typeof enabled !== 'boolean') {
      throw new Error(`enabledProviders.${source} must be a boolean.`)
    }
    enabledProviders[source as AgentSource] = enabled
  })

  return enabledProviders
}

function normalizeExcludedFolders(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('excludedFolders must be an array.')
  return Array.from(new Set(value.map((item) => normalizePath(item, 'excludedFolders'))))
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
  return value
}

function normalizeVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('soundVolume must be a number between 0 and 100.')
  }
  return value
}

function safeScanRoots(value: unknown): AppSettings['scanRoots'] {
  if (!isRecord(value)) return {}
  const scanRoots: AppSettings['scanRoots'] = {}
  Object.entries(value).forEach(([source, roots]) => {
    if (!agentSources.includes(source as AgentSource) || !Array.isArray(roots)) return
    const safeRoots = roots
      .filter((root): root is string => typeof root === 'string' && isSafePathString(root))
      .map((root) => expandHome(root.trim()))
    if (safeRoots.length > 0) scanRoots[source as AgentSource] = safeRoots
  })
  return scanRoots
}

function normalizeSettingsPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  if (!isRecord(patch)) throw new Error('settings patch must be an object.')

  const next: Partial<AppSettings> = {}
  if ('scanRoots' in patch) next.scanRoots = normalizeScanRoots(patch.scanRoots)
  if ('enabledProviders' in patch) {
    next.enabledProviders = normalizeEnabledProviders(patch.enabledProviders)
  }
  if ('cleanupRetentionDays' in patch) {
    next.cleanupRetentionDays = normalizeDays(patch.cleanupRetentionDays, 'cleanupRetentionDays')
  }
  if ('trashRetentionDays' in patch) {
    next.trashRetentionDays = normalizeDays(patch.trashRetentionDays, 'trashRetentionDays')
  }
  if ('autoBackup' in patch) {
    next.autoBackup = normalizeBoolean(patch.autoBackup, 'autoBackup')
  }
  if ('mockDataEnabled' in patch) {
    next.mockDataEnabled = normalizeBoolean(patch.mockDataEnabled, 'mockDataEnabled')
  }
  if ('language' in patch) {
    if (!appLanguages.includes(patch.language as AppLanguage)) {
      throw new Error('language is not supported.')
    }
    next.language = patch.language as AppLanguage
  }
  if ('launchAtLogin' in patch) {
    next.launchAtLogin = normalizeBoolean(patch.launchAtLogin, 'launchAtLogin')
  }
  if ('scanOnLaunch' in patch) {
    next.scanOnLaunch = normalizeBoolean(patch.scanOnLaunch, 'scanOnLaunch')
  }
  if ('backgroundScan' in patch) {
    next.backgroundScan = normalizeBoolean(patch.backgroundScan, 'backgroundScan')
  }
  if ('confirmBeforeCleanup' in patch) {
    next.confirmBeforeCleanup = normalizeBoolean(patch.confirmBeforeCleanup, 'confirmBeforeCleanup')
  }
  if ('excludedFolders' in patch) {
    next.excludedFolders = normalizeExcludedFolders(patch.excludedFolders)
  }
  if ('soundEffects' in patch) {
    next.soundEffects = normalizeBoolean(patch.soundEffects, 'soundEffects')
  }
  if ('cleanupSound' in patch) {
    next.cleanupSound = normalizeBoolean(patch.cleanupSound, 'cleanupSound')
  }
  if ('scanSound' in patch) {
    next.scanSound = normalizeBoolean(patch.scanSound, 'scanSound')
  }
  if ('errorSound' in patch) {
    next.errorSound = normalizeBoolean(patch.errorSound, 'errorSound')
  }
  if ('soundVolume' in patch) {
    next.soundVolume = normalizeVolume(patch.soundVolume)
  }
  if ('checkForUpdates' in patch) {
    next.checkForUpdates = normalizeBoolean(patch.checkForUpdates, 'checkForUpdates')
  }
  if ('defaultRelayMode' in patch) {
    if (!relayModes.includes(patch.defaultRelayMode as AppSettings['defaultRelayMode'])) {
      throw new Error('defaultRelayMode is not supported.')
    }
    next.defaultRelayMode = patch.defaultRelayMode as AppSettings['defaultRelayMode']
  }
  if ('exportDirectory' in patch) {
    next.exportDirectory = normalizePath(patch.exportDirectory, 'exportDirectory')
  }

  return next
}

function usageSeed(date: string): UsagePoint {
  return {
    date,
    codex: 0,
    claude: 0,
    cursor: 0,
    gemini: 0,
    opencode: 0,
    custom: 0,
    total: 0,
  }
}

function archiveBytes(records: ArchiveRecord[]): number {
  return records.reduce((total, record) => total + record.compressedBytes, 0)
}

function usageByDateFromMetadata(
  metadata: Record<string, unknown>,
): Record<string, number> | undefined {
  const value = metadata.usageByDate
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const usageByDate: Record<string, number> = {}
  Object.entries(value).forEach(([date, tokens]) => {
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) {
      usageByDate[date] = tokens
    }
  })

  return usageByDate
}

function markdownForSession(session: SessionRecord): string {
  return [
    `# ${session.title}`,
    '',
    `- Agent: ${agentLabels[session.source]}`,
    `- Project: ${session.projectName}`,
    `- Branch: ${session.branch ?? 'Unknown'}`,
    `- Last updated: ${session.lastUpdated}`,
    `- Messages: ${session.messageCount}`,
    `- Tokens: ${session.tokens.total.toLocaleString()}${session.tokens.estimated ? ' (estimated)' : ''}`,
    `- Cost: ${typeof session.tokens.costUsd === 'number' ? `$${session.tokens.costUsd.toFixed(4)}` : 'Unknown'}`,
    `- Size: ${session.sizeBytes} bytes`,
    `- Storage: ${session.storagePath}`,
    '',
    '## Metadata',
    '',
    '```json',
    JSON.stringify(session.metadata, null, 2),
    '```',
    '',
  ].join('\n')
}

function sessionSearchText(session: SessionRecord): string {
  const values = [
    session.title,
    session.projectName,
    session.projectPath,
    session.branch,
    session.source,
    ...session.tags,
    session.searchText,
  ]
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16_000)
}

export class AppService {
  private readonly db: LocalDatabase
  private readonly userDataPath: string
  private readonly openPathHandler: (targetPath: string) => Promise<unknown>
  private launchScanCompleted = false
  private scanStates = new Map<AgentSource, AgentInstallState>()
  private settings?: AppSettings

  constructor(options: {
    userDataPath: string
    openPath?: (targetPath: string) => Promise<unknown>
  }) {
    const { userDataPath, openPath = async () => undefined } = options
    this.userDataPath = userDataPath
    this.openPathHandler = openPath
    this.db = new LocalDatabase(path.join(userDataPath, 'clean-my-agent.sqlite'))
  }

  async init(): Promise<void> {
    await this.db.open()
    this.settings = this.mergeSettings(this.db.getSetting<Partial<AppSettings>>('settings'))
    this.db.setSetting('settings', this.settings)
  }

  async getSnapshot(forceRescan = false): Promise<DashboardSnapshot> {
    const settings = this.requireSettings()
    const shouldRunLaunchScan = settings.scanOnLaunch && !this.launchScanCompleted
    if (forceRescan || shouldRunLaunchScan || this.shouldRescanCachedSessions()) {
      this.launchScanCompleted = true
      await this.rescan()
    }

    const archives = this.db.getArchives()
    const allSessions = this.mergeBackupStatus([
      ...this.db.getSessions(),
      ...this.sessionsFromArchives(archives),
    ])
    const enabledSources = new Set(enabledProviderSources(settings))
    const sessions = allSessions.filter((session) => enabledSources.has(session.source))
    const backups = this.db.getBackups()
    const trash = this.db.getTrash()
    const liveSessions = sessions.filter((session) => session.storageState === 'live')
    const cleanup = this.buildCleanupCandidates(liveSessions, backups)
    const lastScannedAt = this.db.getSetting<string>('lastScannedAt')
    const agents = await Promise.all(
      adapters.map(async (adapter): Promise<AgentInstallState> => {
        const providerEnabled = enabledSources.has(adapter.source)
        const sourceSessions = sessions.filter((session) => session.source === adapter.source)
        const liveSourceSessions = sourceSessions.filter(
          (session) => session.storageState === 'live',
        )
        const roots = adapter.roots(settings)
        const hasConfiguredRoots = roots.length > 0
        const state = this.scanStates.get(adapter.source)
        return {
          ...state,
          source: adapter.source,
          name: adapter.name,
          installed: providerEnabled
            ? (state?.installed ?? sourceSessions.length > 0) ||
              (adapter.source === 'custom' && hasConfiguredRoots)
            : false,
          readable: providerEnabled ? (state?.readable ?? sourceSessions.length > 0) : false,
          rootPaths: state?.rootPaths ?? roots,
          sessionCount: sourceSessions.length,
          sizeBytes: bytesFromRecords(liveSourceSessions),
          lastScannedAt: providerEnabled ? (state?.lastScannedAt ?? lastScannedAt) : undefined,
          note: providerEnabled ? (state?.note ?? adapter.name) : 'Provider disabled in Settings.',
        }
      }),
    )

    return {
      generatedAt: new Date().toISOString(),
      overview: {
        totalSessions: sessions.length,
        backedUpSessions: sessions.filter((session) => session.backupStatus === 'backed-up').length,
        reclaimableBytes: cleanup.reduce((total, item) => total + item.sizeBytes, 0),
        lastBackupAt: backups[0]?.createdAt,
        totalTokens: sessions.reduce((total, session) => total + session.tokens.total, 0),
        totalCostUsd: sessions.reduce((total, session) => total + (session.tokens.costUsd ?? 0), 0),
        totalSizeBytes: bytesFromRecords(liveSessions) + archiveBytes(archives),
        highRiskCleanupCount: cleanup.filter((item) => item.risk === 'high').length,
      },
      agents,
      sessions,
      cleanup,
      archives,
      backups,
      trash,
      usage: this.buildUsage(sessions),
      storage: this.buildStorage(sessions, archives, backups, trash),
    }
  }

  async rescan(): Promise<DashboardSnapshot> {
    const settings = this.requireSettings()
    const enabledSources = new Set(enabledProviderSources(settings))
    const activeAdapters = adapters.filter((adapter) => enabledSources.has(adapter.source))
    const results = await Promise.all(activeAdapters.map((adapter) => adapter.scan(settings)))
    this.scanStates = new Map(results.map((result) => [result.state.source, result.state]))
    const sessions = results.flatMap((result) => result.sessions)
    const inactiveCachedSessions = this.db
      .getSessions()
      .filter((session) => !enabledSources.has(session.source))
    this.db.replaceSessions(this.mergeBackupStatus([...inactiveCachedSessions, ...sessions]))
    this.db.setSetting('scanSchemaVersion', scanSchemaVersion)
    this.db.setSetting('lastScannedAt', new Date().toISOString())
    return this.getSnapshot(false)
  }

  async refreshRecentSessions(limit = 10): Promise<DashboardSnapshot> {
    const settings = this.requireSettings()
    const enabledSources = new Set(enabledProviderSources(settings))
    const candidateGroups = await Promise.all(
      adapters
        .filter((adapter) => enabledSources.has(adapter.source))
        .map(async (adapter) => ({
          adapter,
          candidates: await adapter.recentCandidates(settings, limit),
        })),
    )
    const latestCandidates = candidateGroups
      .flatMap(({ adapter, candidates }) => candidates.map((candidate) => ({ adapter, candidate })))
      .sort((a, b) => b.candidate.mtimeMs - a.candidate.mtimeMs)
      .slice(0, limit)

    const sessions = (
      await Promise.all(
        latestCandidates.map(({ adapter, candidate }) => adapter.scanCandidates([candidate])),
      )
    ).flat()
    this.db.upsertSessions(this.mergeBackupStatus(sessions))
    return this.getSnapshot(false)
  }

  async backupSession(sessionId: string): Promise<BackupRecord> {
    const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
    const createdAt = new Date().toISOString()
    const backupRoot = path.join(this.userDataPath, 'Backups', session.source)
    const extension = path.extname(session.storagePath)
    const filename = `${sanitizeName(session.title)}-${session.id}${extension || '.backup'}`
    const backupPath = path.join(backupRoot, filename)

    await copyPath(session.storagePath, backupPath)
    const record: BackupRecord = {
      id: hashId([session.id, backupPath, createdAt]),
      sessionId: session.id,
      source: session.source,
      title: session.title,
      createdAt,
      sizeBytes: await pathSize(backupPath),
      backupPath,
      originalPath: session.storagePath,
      format: 'raw-copy',
    }
    this.db.insertBackup(record)
    return record
  }

  async archiveSession(sessionId: string): Promise<ArchiveRecord> {
    const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
    if (session.storageState === 'archived') {
      const existing = this.db.getArchiveBySessionId(sessionId)
      if (existing) return existing
      throw new Error(`Archived session record not found: ${sessionId}`)
    }
    if (session.storageKind === 'directory') {
      throw new Error('Vault archive currently supports single-file sessions.')
    }
    if (!(await exists(session.storagePath))) {
      throw new Error(`Session file not found: ${session.storagePath}`)
    }

    const archivedAt = new Date().toISOString()
    const archiveRoot = path.join(this.userDataPath, 'Vault', session.source)
    const archivePath = path.join(
      archiveRoot,
      `${sanitizeName(session.title)}-${session.id}${path.extname(session.storagePath) || '.session'}.br`,
    )
    const originalBytes = await pathSize(session.storagePath)
    const contentHash = await hashFile(session.storagePath)
    await compressFileBrotli(session.storagePath, archivePath)
    const compressedBytes = await pathSize(archivePath)

    const archivedSession: SessionRecord = {
      ...session,
      storageState: 'archived',
      searchText: sessionSearchText(session),
      metadata: {
        ...session.metadata,
        archivedAt,
        originalPath: session.storagePath,
      },
    }
    const record: ArchiveRecord = {
      id: hashId([session.id, archivePath, archivedAt]),
      sessionId: session.id,
      source: session.source,
      title: session.title,
      createdAt: session.createdAt ?? archivedAt,
      archivedAt,
      originalPath: session.storagePath,
      archivePath,
      originalBytes,
      compressedBytes,
      contentHash,
      compression: 'brotli',
      restorable: true,
      session: archivedSession,
    }
    this.db.insertArchive(record)
    await removePath(session.storagePath)
    await this.rescan()
    return record
  }

  async restoreArchive(archiveId: string): Promise<void> {
    const record = this.db.getArchiveRecord(validateIdentifier(archiveId, 'archiveId'))
    if (!record) throw new Error(`Archive item not found: ${archiveId}`)
    if (await exists(record.originalPath)) {
      throw new Error(
        `Cannot restore archive because the original path already exists: ${record.originalPath}`,
      )
    }

    await decompressFileBrotli(record.archivePath, record.originalPath)
    const restoredHash = await hashFile(record.originalPath)
    if (restoredHash !== record.contentHash) {
      await removePath(record.originalPath)
      throw new Error('Restored archive checksum did not match the original session.')
    }
    this.db.deleteArchiveRecord(archiveId)
    await removePath(record.archivePath)
    await this.rescan()
  }

  async exportSession(sessionId: string, format: ExportFormat): Promise<string> {
    if (!exportFormats.includes(format)) throw new Error(`Unsupported export format: ${format}`)
    const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
    const exportRoot = this.requireSettings().exportDirectory
    const basename = `${sanitizeName(session.title)}-${session.id}`

    if (format === 'universal-json') return this.exportUniversalRelay(sessionId)

    const exportPath = path.join(exportRoot, `${basename}.${format === 'json' ? 'json' : 'md'}`)
    await ensureDir(path.dirname(exportPath))

    if (format === 'json') {
      await writeJson(exportPath, session)
    } else {
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(exportPath, markdownForSession(session)),
      )
    }

    return exportPath
  }

  async exportUniversalRelay(sessionId: string): Promise<string> {
    const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
    const adapter = adapterFor(session.source)
    const archive =
      session.storageState === 'archived' ? this.db.getArchiveBySessionId(session.id) : undefined
    let restorePath: string | undefined
    let document
    try {
      if (archive) {
        const extension = path.extname(archive.originalPath) || '.session'
        restorePath = path.join(
          this.userDataPath,
          'Temp',
          'relay',
          `${archive.sessionId}-${Date.now()}${extension}`,
        )
        await decompressFileBrotli(archive.archivePath, restorePath)
      }
      document = await adapter.toUniversal(
        restorePath ? { ...session, storagePath: restorePath } : session,
      )
    } finally {
      if (restorePath) await removePath(restorePath)
    }
    const exportPath = path.join(
      this.requireSettings().exportDirectory,
      `${sanitizeName(session.title)}-${session.id}.universal-session.json`,
    )
    await writeJson(exportPath, document)
    return exportPath
  }

  async scanCleanup(): Promise<CleanupCandidate[]> {
    const enabledSources = new Set(enabledProviderSources(this.requireSettings()))
    return this.buildCleanupCandidates(
      this.mergeBackupStatus(this.db.getSessions()).filter((session) =>
        enabledSources.has(session.source),
      ),
      this.db.getBackups(),
    )
  }

  async moveCleanupToTrash(candidateIds: string[]): Promise<TrashRecord[]> {
    const ids = validateIdentifierArray(candidateIds, 'candidateIds')
    const candidates = await this.scanCleanup()
    const selected = candidates.filter((candidate) => ids.includes(candidate.id))
    const records: TrashRecord[] = []

    for (const candidate of selected) {
      if (!candidate.backedUp && candidate.sessionIds.length > 0) {
        for (const sessionId of candidate.sessionIds) {
          await this.backupSession(sessionId)
        }
      }

      const deletedAt = new Date().toISOString()
      const trashPath = path.join(
        this.userDataPath,
        'Trash',
        `${sanitizeName(candidate.title)}-${candidate.id}`,
      )
      await ensureDir(trashPath)

      const movedPaths: string[] = []
      for (const originalPath of candidate.paths) {
        if (!(await exists(originalPath))) continue
        const target = path.join(trashPath, sanitizeName(path.basename(originalPath)))
        await movePath(originalPath, target)
        movedPaths.push(originalPath)
      }

      const record: TrashRecord = {
        id: hashId([candidate.id, deletedAt]),
        candidateId: candidate.id,
        title: candidate.title,
        source: candidate.source,
        originalPaths: movedPaths,
        trashPath,
        sizeBytes: await pathSize(trashPath),
        deletedAt,
        risk: candidate.risk,
        recoverable: true,
      }
      this.db.insertTrash(record)
      records.push(record)
    }

    await this.rescan()
    return records
  }

  async restoreTrash(trashId: string): Promise<void> {
    const record = this.db.getTrashRecord(validateIdentifier(trashId, 'trashId'))
    if (!record) throw new Error(`Trash item not found: ${trashId}`)

    for (const originalPath of record.originalPaths) {
      const source = path.join(record.trashPath, sanitizeName(path.basename(originalPath)))
      if (await exists(source)) await movePath(source, originalPath)
    }
    this.db.deleteTrashRecord(trashId)
    await this.rescan()
  }

  async purgeExpiredTrash(): Promise<TrashRecord[]> {
    const retentionMs = this.requireSettings().trashRetentionDays * oneDayMs
    const now = Date.now()
    const purged: TrashRecord[] = []

    for (const record of this.db.getTrash()) {
      const deletedAt = new Date(record.deletedAt).getTime()
      if (Number.isNaN(deletedAt)) continue
      if (now - deletedAt <= retentionMs) continue

      await removePath(record.trashPath)
      this.db.deleteTrashRecord(record.id)
      purged.push(record)
    }

    return purged
  }

  getSettings(): AppSettings {
    return this.requireSettings()
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.requireSettings()
    const normalizedPatch = normalizeSettingsPatch(patch)
    const next = this.mergeSettings({
      ...current,
      ...normalizedPatch,
      scanRoots: {
        ...current.scanRoots,
        ...normalizedPatch.scanRoots,
      },
      enabledProviders: {
        ...current.enabledProviders,
        ...normalizedPatch.enabledProviders,
      },
    })
    this.settings = next
    this.db.setSetting('settings', next)
    return next
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const checkedAt = new Date().toISOString()
    const fallback = { currentVersion: currentAppVersion, updateAvailable: false, checkedAt }

    try {
      const response = await fetch(
        'https://api.github.com/repos/blain3white/clean-my-agent/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } },
      )
      if (!response.ok) return fallback
      const json = (await response.json()) as {
        tag_name?: string
        html_url?: string
      }
      const latestVersion = json.tag_name?.replace(/^v/i, '')
      return {
        currentVersion: currentAppVersion,
        latestVersion,
        updateAvailable: Boolean(latestVersion && latestVersion !== currentAppVersion),
        releaseUrl: json.html_url,
        checkedAt,
      }
    } catch {
      return fallback
    }
  }

  async openPath(targetPath: string): Promise<void> {
    await this.openPathHandler(normalizePath(targetPath, 'targetPath'))
  }

  private defaultSettings(): AppSettings {
    return {
      scanRoots: {},
      cleanupRetentionDays: 7,
      trashRetentionDays: 14,
      autoBackup: true,
      mockDataEnabled: false,
      language: defaultLanguage,
      launchAtLogin: false,
      enabledProviders: Object.fromEntries(
        agentSources.map((source) => [source, true]),
      ) as AppSettings['enabledProviders'],
      scanOnLaunch: true,
      backgroundScan: true,
      confirmBeforeCleanup: true,
      excludedFolders: [],
      soundEffects: true,
      cleanupSound: true,
      scanSound: false,
      errorSound: true,
      soundVolume: 35,
      checkForUpdates: true,
      defaultRelayMode: 'full-context',
      exportDirectory: path.join(this.userDataPath, 'Exports'),
    }
  }

  private mergeSettings(settings?: Partial<AppSettings>): AppSettings {
    const defaults = this.defaultSettings()
    const raw = isRecord(settings) ? settings : {}
    const language = appLanguages.includes(raw.language as AppLanguage)
      ? (raw.language as AppLanguage)
      : defaults.language
    const defaultRelayMode = relayModes.includes(
      raw.defaultRelayMode as AppSettings['defaultRelayMode'],
    )
      ? (raw.defaultRelayMode as AppSettings['defaultRelayMode'])
      : defaults.defaultRelayMode
    return {
      ...defaults,
      cleanupRetentionDays: safeDays(raw.cleanupRetentionDays, defaults.cleanupRetentionDays),
      trashRetentionDays: safeDays(raw.trashRetentionDays, defaults.trashRetentionDays),
      autoBackup: safeBoolean(raw.autoBackup, defaults.autoBackup),
      mockDataEnabled: safeBoolean(raw.mockDataEnabled, defaults.mockDataEnabled),
      language,
      launchAtLogin: safeBoolean(raw.launchAtLogin, defaults.launchAtLogin),
      enabledProviders: {
        ...defaults.enabledProviders,
        ...(isRecord(raw.enabledProviders)
          ? Object.fromEntries(
              Object.entries(raw.enabledProviders).filter(
                ([source, enabled]) =>
                  agentSources.includes(source as AgentSource) && typeof enabled === 'boolean',
              ),
            )
          : {}),
      },
      scanOnLaunch: safeBoolean(raw.scanOnLaunch, defaults.scanOnLaunch),
      backgroundScan: safeBoolean(raw.backgroundScan, defaults.backgroundScan),
      confirmBeforeCleanup: safeBoolean(raw.confirmBeforeCleanup, defaults.confirmBeforeCleanup),
      excludedFolders: Array.isArray(raw.excludedFolders)
        ? Array.from(
            new Set(
              raw.excludedFolders
                .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
                .map((item) => item.trim()),
            ),
          )
        : defaults.excludedFolders,
      soundEffects: safeBoolean(raw.soundEffects, defaults.soundEffects),
      cleanupSound: safeBoolean(raw.cleanupSound, defaults.cleanupSound),
      scanSound: safeBoolean(raw.scanSound, defaults.scanSound),
      errorSound: safeBoolean(raw.errorSound, defaults.errorSound),
      soundVolume:
        typeof raw.soundVolume === 'number' && Number.isFinite(raw.soundVolume)
          ? Math.min(100, Math.max(0, raw.soundVolume))
          : defaults.soundVolume,
      checkForUpdates: safeBoolean(raw.checkForUpdates, defaults.checkForUpdates),
      defaultRelayMode,
      scanRoots: safeScanRoots(raw.scanRoots),
      exportDirectory: safePath(raw.exportDirectory, defaults.exportDirectory),
    }
  }

  private requireSettings(): AppSettings {
    if (!this.settings) throw new Error('App service is not initialized')
    return this.settings
  }

  private shouldRescanCachedSessions(): boolean {
    if (this.db.getArchives().length > 0) return false
    return (this.db.getSetting<number>('scanSchemaVersion') ?? 0) !== scanSchemaVersion
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.mergeBackupStatus([
      ...this.db.getSessions(),
      ...this.sessionsFromArchives(this.db.getArchives()),
    ]).find((item) => item.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return session
  }

  private mergeBackupStatus(sessions: SessionRecord[]): SessionRecord[] {
    const backedUpIds = new Set(this.db.getBackups().map((backup) => backup.sessionId))
    return sessions.map((session) => ({
      ...session,
      storageState: session.storageState ?? 'live',
      searchText: session.searchText ?? sessionSearchText(session),
      backupStatus: backedUpIds.has(session.id) ? 'backed-up' : session.backupStatus,
    }))
  }

  private sessionsFromArchives(archives: ArchiveRecord[]): SessionRecord[] {
    return archives.map((archive) => ({
      ...archive.session,
      storagePath: archive.archivePath,
      storageState: 'archived',
      sizeBytes: archive.originalBytes,
      searchText: archive.session.searchText ?? sessionSearchText(archive.session),
      metadata: {
        ...archive.session.metadata,
        archivedAt: archive.archivedAt,
        originalPath: archive.originalPath,
        archivePath: archive.archivePath,
        compressedBytes: archive.compressedBytes,
      },
    }))
  }

  private buildCleanupCandidates(
    sessions: SessionRecord[],
    backups: BackupRecord[],
  ): CleanupCandidate[] {
    const now = Date.now()
    const retentionMs = this.requireSettings().cleanupRetentionDays * oneDayMs
    const backupSessionIds = new Set(backups.map((backup) => backup.sessionId))
    const candidates: CleanupCandidate[] = []

    for (const session of sessions) {
      const ageMs = now - new Date(session.lastUpdated).getTime()
      const backedUp = backupSessionIds.has(session.id) || session.backupStatus === 'backed-up'
      if (ageMs > retentionMs) {
        candidates.push({
          id: hashId(['old-session', session.id]),
          kind: backedUp ? 'backed-up-session' : 'old-session',
          title: `${session.title}`,
          source: session.source,
          sessionIds: [session.id],
          paths: [session.storagePath],
          sizeBytes: session.sizeBytes,
          lastUpdated: session.lastUpdated,
          reason: backedUp
            ? `Backed up and inactive for more than ${this.requireSettings().cleanupRetentionDays} days.`
            : `Inactive for more than ${this.requireSettings().cleanupRetentionDays} days; backup will be created first.`,
          risk: backedUp ? 'low' : 'medium',
          recoverable: true,
          backedUp,
        })
      }

      if (session.sizeBytes > 50 * 1024 * 1024) {
        candidates.push({
          id: hashId(['large-session', session.id]),
          kind: session.storagePath.endsWith('.log') ? 'large-log' : 'old-session',
          title: `Large session: ${session.title}`,
          source: session.source,
          sessionIds: [session.id],
          paths: [session.storagePath],
          sizeBytes: session.sizeBytes,
          lastUpdated: session.lastUpdated,
          reason:
            'This session file is unusually large and may include verbose logs or cached context.',
          risk: backedUp ? 'medium' : 'high',
          recoverable: true,
          backedUp,
        })
      }
    }

    const backupGroups = new Map<string, BackupRecord[]>()
    backups.forEach((backup) => {
      const key = `${backup.sessionId}:${backup.sizeBytes}`
      backupGroups.set(key, [...(backupGroups.get(key) ?? []), backup])
    })
    backupGroups.forEach((group) => {
      if (group.length <= 1) return
      const duplicates = group.slice(1)
      candidates.push({
        id: hashId(['duplicate-backup', group[0].sessionId, group.length]),
        kind: 'duplicate-backup',
        title: `Duplicate backups for ${group[0].title}`,
        source: group[0].source,
        sessionIds: [group[0].sessionId],
        paths: duplicates.map((backup) => backup.backupPath),
        sizeBytes: bytesFromRecords(duplicates),
        lastUpdated: duplicates[0]?.createdAt,
        reason:
          'Multiple backups have the same session id and size. Keeping the newest copy is enough.',
        risk: 'low',
        recoverable: true,
        backedUp: true,
      })
    })

    return candidates.sort((a, b) => b.sizeBytes - a.sizeBytes)
  }

  private buildUsage(sessions: SessionRecord[]): UsagePoint[] {
    const points = new Map<string, UsagePoint>()
    for (let offset = usageHistoryDays - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * oneDayMs)
      const key = formatDateKey(date)
      points.set(key, usageSeed(key))
    }

    sessions.forEach((session) => {
      const usageByDate = usageByDateFromMetadata(session.metadata)
      if (usageByDate && Object.keys(usageByDate).length > 0) {
        Object.entries(usageByDate).forEach(([key, tokens]) => {
          const point = points.get(key)
          if (!point) return
          point[session.source] += tokens
          point.total += tokens
        })
        return
      }

      const key = formatDateKey(new Date(session.lastUpdated))
      const point = points.get(key)
      if (!point) return
      point[session.source] += session.tokens.total
      point.total += session.tokens.total
    })

    return Array.from(points.values())
  }

  private buildStorage(
    sessions: SessionRecord[],
    archives: ArchiveRecord[],
    backups: BackupRecord[],
    trash: TrashRecord[],
  ): StorageSlice[] {
    const bySource = new Map<AgentSource, SessionRecord[]>()
    sessions
      .filter((session) => session.storageState === 'live')
      .forEach((session) => {
        bySource.set(session.source, [...(bySource.get(session.source) ?? []), session])
      })

    const slices: StorageSlice[] = Array.from(bySource.entries()).map(([source, items]) => ({
      source,
      label: agentLabels[source],
      sizeBytes: bytesFromRecords(items),
      sessions: items.length,
    }))

    slices.push({
      source: 'archives',
      label: 'Vault',
      sizeBytes: archiveBytes(archives),
      sessions: archives.length,
    })
    slices.push({
      source: 'backups',
      label: 'Backups',
      sizeBytes: bytesFromRecords(backups),
    })
    slices.push({
      source: 'trash',
      label: 'Trash',
      sizeBytes: bytesFromRecords(trash),
    })

    return slices.filter((slice) => slice.sizeBytes > 0).sort((a, b) => b.sizeBytes - a.sizeBytes)
  }
}
