import path from 'node:path'
import os from 'node:os'
import type {
  AgentSource,
  AppLanguage,
  AgentInstallState,
  AgentScanDiagnostic,
  ArchiveRecord,
  AppSettings,
  BackupRecord,
  CleanupCandidate,
  DashboardSnapshot,
  DiagnosticOperation,
  DiagnosticPerformanceMetric,
  DiagnosticReport,
  ExportFormat,
  RecoveryDiagnostic,
  SessionRecord,
  StorageSlice,
  TrashRecord,
  UsagePoint,
  UniversalRelayDocument,
  SkillsSnapshot,
  RecoveryRecord,
  RecoveryStep,
} from '../../src/shared/types'
import { agentSources, appLanguages, defaultLanguage, exportFormats } from '../../src/shared/types'
import { adapters, adapterFor, enabledProviderSources } from './adapters'
import { LocalDatabase } from './database'
import { scanSkills } from './skills'
import { scanWorktrees } from './worktrees'
import {
  compressFileBrotli,
  copyPath,
  decompressFileBrotli,
  ensureDir,
  exists,
  expandHome,
  hashFile,
  hashId,
  homeDir,
  listFiles,
  movePath,
  pathSize,
  removePath,
  safeReadText,
  sanitizeName,
  writeJson,
} from './files'

const oneDayMs = 24 * 60 * 60 * 1000
const usageHistoryDays = 365
const scanSchemaVersion = 5
const maxPathLength = 4096
const maxRetentionDays = 36_500
const relayModes: AppSettings['defaultRelayMode'][] = [
  'full-context',
  'fit-to-window',
  'manual-select',
]
const defaultUsageTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>()
const diagnosticSchema = 'clean-my-agent.diagnostic-report.v1'
const maxDiagnosticOperations = 120
const maxRecentDiagnosticOperations = 50
const maxDiagnosticErrors = 50
const maxDiagnosticTextLength = 500
const claudeDesktopMetadataPattern = '**/local_*.json'
const agentLabels: Record<AgentSource, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  custom: 'Custom',
}

type DiagnosticExportContext = {
  recentOperations?: DiagnosticOperation[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100
}

function diagnosticPathId(value?: string): string | undefined {
  if (!value) return undefined
  return hashId(['diagnostic-path', expandHome(value)])
}

function uniquePaths(paths: string[]): string[] {
  return paths.filter((item, index) => paths.indexOf(item) === index)
}

function claudeDesktopSessionRoots(): string[] {
  const home = os.homedir()
  return uniquePaths(
    [
      process.env.APPDATA
        ? path.join(process.env.APPDATA, 'Claude', 'claude-code-sessions')
        : undefined,
      path.join(home, 'AppData', 'Roaming', 'Claude', 'claude-code-sessions'),
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
      path.join(home, '.config', 'Claude', 'claude-code-sessions'),
    ].filter((item): item is string => Boolean(item)),
  )
}

function sessionFileId(session: SessionRecord): string {
  const extension = path.extname(session.storagePath)
  return path.basename(session.storagePath, extension)
}

function redactDiagnosticText(value: string): string {
  let text = value
  if (homeDir) {
    text = text.replace(new RegExp(`${escapeRegExp(homeDir)}[^\\s'"\\\`)},;]*`, 'g'), '[path]')
  }

  return text
    .replace(/~\/[^\s'")},;]*/g, '[path]')
    .replace(/[A-Za-z]:\\[^\s'")},;]*/g, '[path]')
    .replace(
      /\/(?:Users|home|tmp|private|var|Volumes|Applications|opt|usr|etc)\/[^\s'")},;]*/g,
      '[path]',
    )
    .replace(
      /\b(api[_-]?key|token|secret|password|oauth)[\w.-]*\s*[:=]\s*["']?[^"',\s}]+/gi,
      '$1=[redacted]',
    )
    .slice(0, maxDiagnosticTextLength)
}

function sanitizeOperation(operation: DiagnosticOperation): DiagnosticOperation {
  return {
    ...operation,
    operation: redactDiagnosticText(operation.operation),
    durationMs: roundDuration(operation.durationMs),
    error: operation.error
      ? {
          name: redactDiagnosticText(operation.error.name),
          message: redactDiagnosticText(operation.error.message),
        }
      : undefined,
  }
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'Error'
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error'
}

function summarizePerformance(operations: DiagnosticOperation[]): DiagnosticPerformanceMetric[] {
  const byOperation = new Map<
    string,
    {
      count: number
      errorCount: number
      totalDurationMs: number
      maxDurationMs: number
      lastDurationMs: number
      lastFinishedAt: string
    }
  >()

  operations.forEach((operation) => {
    const current = byOperation.get(operation.operation) ?? {
      count: 0,
      errorCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastDurationMs: 0,
      lastFinishedAt: operation.finishedAt,
    }
    current.count += 1
    current.errorCount += operation.status === 'error' ? 1 : 0
    current.totalDurationMs += operation.durationMs
    current.maxDurationMs = Math.max(current.maxDurationMs, operation.durationMs)

    if (new Date(operation.finishedAt).getTime() >= new Date(current.lastFinishedAt).getTime()) {
      current.lastDurationMs = operation.durationMs
      current.lastFinishedAt = operation.finishedAt
    }

    byOperation.set(operation.operation, current)
  })

  return Array.from(byOperation.entries())
    .map(([operation, item]) => ({
      operation,
      count: item.count,
      errorCount: item.errorCount,
      averageDurationMs: roundDuration(item.totalDurationMs / item.count),
      maxDurationMs: roundDuration(item.maxDurationMs),
      lastDurationMs: roundDuration(item.lastDurationMs),
      lastFinishedAt: item.lastFinishedAt,
    }))
    .sort((a, b) => b.maxDurationMs - a.maxDurationMs)
}

function isSupportedTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

function normalizeTimezone(value: unknown, fallback = defaultUsageTimezone): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const timezone = value.trim()
  return isSupportedTimezone(timezone) ? timezone : fallback
}

function dateKeyForTimezone(date: Date, timezone: string): string {
  let formatter = dateKeyFormatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateKeyFormatterCache.set(timezone, formatter)
  }
  return formatter.format(date)
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

function normalizeTimezoneSetting(value: unknown): string {
  if (typeof value !== 'string' || !isSupportedTimezone(value.trim())) {
    throw new Error('usageTimezone must be a supported IANA time zone.')
  }
  return value.trim()
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

function safeWorktreeRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((root): root is string => typeof root === 'string' && isSafePathString(root))
        .map((root) => expandHome(root.trim())),
    ),
  )
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
  if ('usageTimezone' in patch) {
    next.usageTimezone = normalizeTimezoneSetting(patch.usageTimezone)
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
  if ('worktreeRoots' in patch) {
    next.worktreeRoots = safeWorktreeRoots(patch.worktreeRoots)
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

function usageEventsByDateFromMetadata(
  metadata: Record<string, unknown>,
  timezone: string,
): Record<string, number> | undefined {
  const value = metadata.usageEvents
  if (!Array.isArray(value)) return undefined

  const usageByDate: Record<string, number> = {}
  value.forEach((item) => {
    if (!isRecord(item)) return
    const timestamp = typeof item.timestamp === 'string' ? item.timestamp : undefined
    const tokens = typeof item.tokens === 'number' && Number.isFinite(item.tokens) ? item.tokens : 0
    if (!timestamp || tokens <= 0) return

    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return
    const key = dateKeyForTimezone(date, timezone)
    usageByDate[key] = (usageByDate[key] ?? 0) + tokens
  })

  return Object.keys(usageByDate).length > 0 ? usageByDate : undefined
}

function isForkedCodexSession(session: SessionRecord): boolean {
  return session.source === 'codex' && typeof session.metadata.codexForkedFromId === 'string'
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

function recoveryStep(
  label: string,
  status: RecoveryStep['status'],
  detail?: string,
): RecoveryStep {
  return {
    label,
    status,
    at: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  }
}

type RecoveryStart = Pick<
  RecoveryRecord,
  'operation' | 'title' | 'explanation' | 'targetId' | 'targetTitle' | 'source' | 'risk'
> &
  Partial<Pick<RecoveryRecord, 'paths' | 'steps' | 'metadata' | 'undo'>>

export class AppService {
  private readonly db: LocalDatabase
  private readonly userDataPath: string
  private readonly appVersion: string
  private readonly openPathHandler: (targetPath: string) => Promise<unknown>
  private diagnosticOperations: DiagnosticOperation[] = []
  private launchScanCompleted = false
  private scanStates = new Map<AgentSource, AgentInstallState>()
  private worktreeCandidates: CleanupCandidate[] = []
  private worktreeDiagnostics: AgentScanDiagnostic[] = []
  private settings?: AppSettings

  constructor(options: {
    userDataPath: string
    appVersion?: string
    openPath?: (targetPath: string) => Promise<unknown>
  }) {
    const { userDataPath, appVersion = '0.0.0', openPath = async () => undefined } = options
    this.userDataPath = userDataPath
    this.appVersion = appVersion
    this.openPathHandler = openPath
    this.db = new LocalDatabase(path.join(userDataPath, 'clean-my-agent.sqlite'))
  }

  async init(): Promise<void> {
    return this.trackAsync('app.init', async () => {
      await this.db.open()
      this.settings = this.mergeSettings(this.db.getSetting<Partial<AppSettings>>('settings'))
      this.db.setSetting('settings', this.settings)
    })
  }

  async getSnapshot(forceRescan = false): Promise<DashboardSnapshot> {
    return this.trackAsync('app.getSnapshot', async () => {
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
      const recovery = this.db.getRecoveryRecords()
      const liveSessions = sessions.filter((session) => session.storageState === 'live')
      const cleanup = [
        ...this.buildCleanupCandidates(liveSessions, backups),
        ...this.worktreeCandidates,
      ].sort((a, b) => b.sizeBytes - a.sizeBytes)
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
            note: providerEnabled
              ? (state?.note ?? adapter.name)
              : 'Provider disabled in Settings.',
          }
        }),
      )

      return {
        generatedAt: new Date().toISOString(),
        overview: {
          totalSessions: sessions.length,
          backedUpSessions: sessions.filter((session) => session.backupStatus === 'backed-up')
            .length,
          reclaimableBytes: cleanup.reduce((total, item) => total + item.sizeBytes, 0),
          lastBackupAt: backups[0]?.createdAt,
          totalTokens: sessions.reduce((total, session) => total + session.tokens.total, 0),
          totalCostUsd: sessions.reduce(
            (total, session) => total + (session.tokens.costUsd ?? 0),
            0,
          ),
          totalSizeBytes: bytesFromRecords(liveSessions) + archiveBytes(archives),
          highRiskCleanupCount: cleanup.filter((item) => item.risk === 'high').length,
        },
        agents,
        sessions,
        cleanup,
        archives,
        backups,
        trash,
        recovery,
        worktreeDiagnostics: this.worktreeDiagnostics,
        usage: this.buildUsage(sessions),
        storage: this.buildStorage(sessions, archives, backups, trash),
      }
    })
  }

  async rescan(): Promise<DashboardSnapshot> {
    return this.trackAsync('app.rescan', async () => {
      const settings = this.requireSettings()
      const enabledSources = new Set(enabledProviderSources(settings))
      const activeAdapters = adapters.filter((adapter) => enabledSources.has(adapter.source))
      const results = await Promise.all(activeAdapters.map((adapter) => adapter.scan(settings)))
      this.scanStates = new Map(results.map((result) => [result.state.source, result.state]))
      await this.refreshWorktreeScan(settings)
      const sessions = results.flatMap((result) => result.sessions)
      const inactiveCachedSessions = this.db
        .getSessions()
        .filter((session) => !enabledSources.has(session.source))
      this.db.replaceSessions(this.mergeBackupStatus([...inactiveCachedSessions, ...sessions]))
      this.db.setSetting('scanSchemaVersion', scanSchemaVersion)
      this.db.setSetting('lastScannedAt', new Date().toISOString())
      return this.getSnapshot(false)
    })
  }

  async refreshRecentSessions(limit = 10): Promise<DashboardSnapshot> {
    return this.trackAsync('app.refreshRecentSessions', async () => {
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
        .flatMap(({ adapter, candidates }) =>
          candidates.map((candidate) => ({ adapter, candidate })),
        )
        .sort((a, b) => b.candidate.mtimeMs - a.candidate.mtimeMs)
        .slice(0, limit)

      const sessions = (
        await Promise.all(
          latestCandidates.map(({ adapter, candidate }) => adapter.scanCandidates([candidate])),
        )
      ).flat()
      this.db.upsertSessions(this.mergeBackupStatus(sessions))
      return this.getSnapshot(false)
    })
  }

  async backupSession(sessionId: string): Promise<BackupRecord> {
    return this.trackAsync('session.backup', async () => {
      const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
      const createdAt = new Date().toISOString()
      const backupRoot = path.join(this.userDataPath, 'Backups', session.source)
      const extension = path.extname(session.storagePath)
      const claudeMetadataFiles = await this.findClaudeDesktopMetadataFiles(session)
      const filename = claudeMetadataFiles.length
        ? `${sanitizeName(session.title)}-${session.id}`
        : `${sanitizeName(session.title)}-${session.id}${extension || '.backup'}`
      const backupPath = path.join(backupRoot, filename)
      const backupTargets = [
        { label: 'Original session', path: session.storagePath, role: 'source' as const },
        ...claudeMetadataFiles.map((file) => ({
          label: 'Claude Desktop metadata',
          path: file.path,
          role: 'source' as const,
        })),
        { label: 'Backup copy', path: backupPath, role: 'backup' as const },
      ]

      const recovery = this.startRecovery({
        operation: 'backup',
        title: `Backup ${session.title}`,
        explanation:
          'Copies the live session into the app Backups folder before any cleanup or manual safety action.',
        targetId: session.id,
        targetTitle: session.title,
        source: session.source,
        risk: 'low',
        paths: backupTargets,
      })

      try {
        if (claudeMetadataFiles.length) {
          await copyPath(
            session.storagePath,
            path.join(backupPath, 'session', path.basename(session.storagePath)),
          )
          await Promise.all(
            claudeMetadataFiles.map((file) =>
              copyPath(file.path, path.join(backupPath, 'claude-code-sessions', file.relativePath)),
            ),
          )
        } else {
          await copyPath(session.storagePath, backupPath)
        }
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
        this.completeRecovery(recovery, {
          undo: {
            kind: 'remove-created-paths',
            available: true,
            label: 'Remove this backup',
          },
          metadata: { backupId: record.id, sessionId: session.id },
        })
        return record
      } catch (error) {
        await removePath(backupPath)
        this.failRecovery(recovery, error)
        throw error
      }
    })
  }

  private async findClaudeDesktopMetadataFiles(
    session: SessionRecord,
  ): Promise<Array<{ path: string; relativePath: string }>> {
    if (session.source !== 'claude' || path.extname(session.storagePath) !== '.jsonl') return []

    const cliSessionId = sessionFileId(session)
    const matches: Array<{ path: string; relativePath: string }> = []
    for (const root of claudeDesktopSessionRoots()) {
      const files = await listFiles(root, [claudeDesktopMetadataPattern], 5000)
      for (const filePath of files) {
        try {
          const metadata = JSON.parse(await safeReadText(filePath, 500_000)) as {
            cliSessionId?: unknown
          }
          if (metadata.cliSessionId !== cliSessionId) continue
          matches.push({
            path: filePath,
            relativePath: path.relative(expandHome(root), filePath),
          })
        } catch {
          continue
        }
      }
    }
    return matches
  }

  async archiveSession(sessionId: string): Promise<ArchiveRecord> {
    return this.trackAsync('session.archive', async () => {
      const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
      if (session.storageState === 'archived') {
        const existing = this.db.getArchiveBySessionId(sessionId)
        if (existing) return existing
        throw new Error(`Archived session record not found: ${sessionId}`)
      }

      const archivedAt = new Date().toISOString()
      const archiveRoot = path.join(this.userDataPath, 'Vault', session.source)
      const archivePath = path.join(
        archiveRoot,
        `${sanitizeName(session.title)}-${session.id}${path.extname(session.storagePath) || '.session'}.br`,
      )
      const recovery = this.startRecovery({
        operation: 'archive',
        title: `Archive ${session.title}`,
        explanation:
          'Compresses the live session into the Vault and removes the original live file after the archive is written.',
        targetId: session.id,
        targetTitle: session.title,
        source: session.source,
        risk: 'medium',
        paths: [
          { label: 'Original session', path: session.storagePath, role: 'source' },
          { label: 'Vault archive', path: archivePath, role: 'destination' },
        ],
      })

      let archiveRecordId: string | undefined
      let originalRemoved = false
      let completedRecovery: RecoveryRecord | undefined
      try {
        if (session.storageKind === 'directory') {
          throw new Error('Vault archive currently supports single-file sessions.')
        }
        if (!(await exists(session.storagePath))) {
          throw new Error(`Session file not found: ${session.storagePath}`)
        }

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
        archiveRecordId = record.id
        await removePath(session.storagePath)
        originalRemoved = true
        completedRecovery = this.completeRecovery(recovery, {
          undo: {
            kind: 'restore-archive',
            available: true,
            label: 'Restore this archive',
          },
          metadata: { archiveId: record.id, sessionId: session.id },
        })
        await this.rescan()
        return record
      } catch (error) {
        if (originalRemoved) {
          if (completedRecovery) {
            this.saveRecovery({
              ...completedRecovery,
              diagnostics: [
                ...completedRecovery.diagnostics,
                {
                  level: 'warning',
                  code: 'rescan.failed',
                  message: errorMessage(error),
                },
              ],
            })
          }
          throw error
        }
        if (archiveRecordId) this.db.deleteArchiveRecord(archiveRecordId)
        await removePath(archivePath)
        this.failRecovery(recovery, error)
        throw error
      }
    })
  }

  async restoreArchive(archiveId: string): Promise<void> {
    return this.trackAsync('archive.restore', async () => {
      const record = this.db.getArchiveRecord(validateIdentifier(archiveId, 'archiveId'))
      if (!record) throw new Error(`Archive item not found: ${archiveId}`)
      const checkpointPath = path.join(
        this.userDataPath,
        'Recovery',
        'restore-archive',
        `${record.id}-${Date.now()}${path.extname(record.archivePath) || '.br'}`,
      )
      const recovery = this.startRecovery({
        operation: 'restore',
        title: `Restore ${record.title}`,
        explanation:
          'Restores the Vault archive to its original live path and keeps a recovery checkpoint so the restore can be undone.',
        targetId: record.id,
        targetTitle: record.title,
        source: record.source,
        risk: 'medium',
        paths: [
          { label: 'Vault archive', path: record.archivePath, role: 'source' },
          { label: 'Original restore path', path: record.originalPath, role: 'restored' },
          { label: 'Restore checkpoint', path: checkpointPath, role: 'checkpoint' },
        ],
      })

      try {
        await copyPath(record.archivePath, checkpointPath)
        await this.restoreArchiveRecord(record)
        this.completeRecovery(recovery, {
          undo: {
            kind: 'restore-pre-restore-archive',
            available: true,
            label: 'Move restored session back to Vault',
          },
          metadata: {
            archiveRecord: record,
            archiveId: record.id,
            checkpointPath,
            restoredPath: record.originalPath,
          },
        })
      } catch (error) {
        await removePath(checkpointPath)
        this.failRecovery(recovery, error)
        throw error
      }
    })
  }

  async exportSession(sessionId: string, format: ExportFormat): Promise<string> {
    return this.trackAsync('session.export', async () => {
      if (!exportFormats.includes(format)) throw new Error(`Unsupported export format: ${format}`)
      const session = this.requireSession(validateIdentifier(sessionId, 'sessionId'))
      const exportRoot = this.requireSettings().exportDirectory
      const basename = `${sanitizeName(session.title)}-${session.id}`

      if (format === 'universal-json') {
        const document = await this.buildUniversalRelayDocument(session.id)
        const exportPath = path.join(exportRoot, `${basename}.universal-session.json`)
        await writeJson(exportPath, document)
        return exportPath
      }

      const exportPath = path.join(exportRoot, `${basename}.${format === 'json' ? 'json' : 'md'}`)
      const recovery = this.startRecovery({
        operation: 'export',
        title: `Export ${session.title}`,
        explanation:
          'Writes a copy of the selected session to the configured export folder without changing the live session.',
        targetId: session.id,
        targetTitle: session.title,
        source: session.source,
        risk: 'low',
        paths: [
          { label: 'Source session', path: session.storagePath, role: 'source' },
          { label: 'Export file', path: exportPath, role: 'export' },
        ],
        metadata: { format },
      })

      try {
        await ensureDir(path.dirname(exportPath))
        if (format === 'json') {
          await writeJson(exportPath, session)
        } else {
          await import('node:fs/promises').then(({ writeFile }) =>
            writeFile(exportPath, markdownForSession(session)),
          )
        }
        this.completeRecovery(recovery, {
          undo: {
            kind: 'remove-created-paths',
            available: true,
            label: 'Remove this export',
          },
          metadata: { format, exportPath, sessionId: session.id },
        })
        return exportPath
      } catch (error) {
        await removePath(exportPath)
        this.failRecovery(recovery, error)
        throw error
      }
    })
  }

  async getSessionDetail(sessionId: string): Promise<UniversalRelayDocument> {
    return this.trackAsync('session.detail', () =>
      this.buildUniversalRelayDocument(validateIdentifier(sessionId, 'sessionId')),
    )
  }

  async exportUniversalRelay(sessionId: string): Promise<string> {
    return this.trackAsync('relay.exportUniversal', async () => {
      const sessionIdValue = validateIdentifier(sessionId, 'sessionId')
      const session = this.requireSession(sessionIdValue)
      const exportPath = path.join(
        this.requireSettings().exportDirectory,
        `${sanitizeName(session.title)}-${session.id}.universal-session.json`,
      )

      const recovery = this.startRecovery({
        operation: 'export',
        title: `Export relay ${session.title}`,
        explanation:
          'Writes a universal relay JSON copy of the selected session for portable recovery or migration.',
        targetId: session.id,
        targetTitle: session.title,
        source: session.source,
        risk: 'low',
        paths: [
          { label: 'Source session', path: session.storagePath, role: 'source' },
          { label: 'Universal relay export', path: exportPath, role: 'export' },
        ],
        metadata: { format: 'universal-json' },
      })

      try {
        const document = await this.buildUniversalRelayDocument(sessionIdValue)
        await writeJson(exportPath, document)
        this.completeRecovery(recovery, {
          undo: {
            kind: 'remove-created-paths',
            available: true,
            label: 'Remove this relay export',
          },
          metadata: { format: 'universal-json', exportPath, sessionId: session.id },
        })
        return exportPath
      } catch (error) {
        await removePath(exportPath)
        this.failRecovery(recovery, error)
        throw error
      }
    })
  }

  async exportDiagnostics(): Promise<string> {
    return this.trackAsync('diagnostics.export', async () => {
      const capturedOperations = this.diagnosticOperations.map(sanitizeOperation)
      const report = this.buildDiagnosticReport({ recentOperations: capturedOperations })
      const exportPath = path.join(
        this.requireSettings().exportDirectory,
        `clean-my-agent-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      )
      await writeJson(exportPath, report)
      return exportPath
    })
  }

  async scanCleanup(): Promise<CleanupCandidate[]> {
    return this.trackAsync('cleanup.scan', async () => {
      const settings = this.requireSettings()
      const enabledSources = new Set(enabledProviderSources(settings))
      const sessionCandidates = this.buildCleanupCandidates(
        this.mergeBackupStatus(this.db.getSessions()).filter((session) =>
          enabledSources.has(session.source),
        ),
        this.db.getBackups(),
      )
      await this.refreshWorktreeScan(settings)
      return [...sessionCandidates, ...this.worktreeCandidates].sort(
        (a, b) => b.sizeBytes - a.sizeBytes,
      )
    })
  }

  private async refreshWorktreeScan(settings: AppSettings): Promise<void> {
    const result = await scanWorktrees({
      roots: settings.worktreeRoots,
      retentionDays: settings.cleanupRetentionDays,
      excludedFolders: settings.excludedFolders,
    })
    this.worktreeCandidates = result.candidates
    this.worktreeDiagnostics = result.diagnostics
  }

  async moveCleanupToTrash(candidateIds: string[]): Promise<TrashRecord[]> {
    return this.trackAsync('cleanup.moveToTrash', async () => {
      const ids = validateIdentifierArray(candidateIds, 'candidateIds')
      const candidates = await this.scanCleanup()
      const selected = candidates.filter((candidate) => ids.includes(candidate.id))
      const records: TrashRecord[] = []
      if (selected.length === 0) return records

      const recoveryPaths: RecoveryRecord['paths'] = selected.flatMap((candidate) =>
        candidate.paths.map((candidatePath) => ({
          label: `Cleanup source: ${candidate.title}`,
          path: candidatePath,
          role: 'source' as const,
        })),
      )
      const recovery = this.startRecovery({
        operation: 'trash',
        title: `Move ${selected.length} cleanup item${selected.length === 1 ? '' : 's'} to Trash`,
        explanation:
          'Backs up any unprotected sessions first, then moves cleanup candidate files into the app Trash instead of permanently deleting them.',
        risk: selected.some((candidate) => candidate.risk === 'high')
          ? 'high'
          : selected.some((candidate) => candidate.risk === 'medium')
            ? 'medium'
            : 'low',
        paths: recoveryPaths,
        metadata: { candidateIds: ids },
      })
      const movedPaths: Array<{ from: string; to: string }> = []
      const createdTrashIds: string[] = []
      const createdTrashPaths: string[] = []

      for (const candidate of selected) {
        try {
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
          createdTrashPaths.push(trashPath)
          recoveryPaths.push({
            label: `App Trash: ${candidate.title}`,
            path: trashPath,
            role: 'trash',
          })

          const originalPaths: string[] = []
          for (const originalPath of candidate.paths) {
            if (!(await exists(originalPath))) continue
            const target = path.join(trashPath, sanitizeName(path.basename(originalPath)))
            await movePath(originalPath, target)
            movedPaths.push({ from: originalPath, to: target })
            originalPaths.push(originalPath)
            recoveryPaths.push({
              label: `Moved copy: ${candidate.title}`,
              path: target,
              role: 'trash',
            })
          }

          const record: TrashRecord = {
            id: hashId([candidate.id, deletedAt]),
            candidateId: candidate.id,
            title: candidate.title,
            source: candidate.source,
            originalPaths,
            trashPath,
            sizeBytes: await pathSize(trashPath),
            deletedAt,
            risk: candidate.risk,
            recoverable: true,
          }
          this.db.insertTrash(record)
          createdTrashIds.push(record.id)
          records.push(record)
        } catch (error) {
          for (const movedPath of movedPaths.slice().reverse()) {
            if ((await exists(movedPath.to)) && !(await exists(movedPath.from))) {
              await movePath(movedPath.to, movedPath.from)
            }
          }
          createdTrashIds.forEach((trashId) => this.db.deleteTrashRecord(trashId))
          for (const trashPath of createdTrashPaths) {
            await removePath(trashPath)
          }
          this.failRecovery(recovery, error, {
            paths: recoveryPaths,
            metadata: { candidateIds: ids, movedPaths },
          })
          throw error
        }
      }

      const completedRecovery = this.completeRecovery(recovery, {
        paths: recoveryPaths,
        undo: {
          kind: 'restore-trash',
          available: records.length > 0,
          label: 'Restore moved cleanup items',
          ...(records.length === 0 ? { reason: 'No files were moved to Trash.' } : {}),
        },
        metadata: {
          candidateIds: ids,
          trashIds: records.map((record) => record.id),
          movedPaths,
        },
      })
      try {
        await this.rescan()
      } catch (error) {
        this.saveRecovery({
          ...completedRecovery,
          diagnostics: [
            ...completedRecovery.diagnostics,
            {
              level: 'warning',
              code: 'rescan.failed',
              message: errorMessage(error),
            },
          ],
        })
        throw error
      }
      return records
    })
  }

  async restoreTrash(trashId: string): Promise<void> {
    return this.trackAsync('trash.restore', async () => {
      const record = this.db.getTrashRecord(validateIdentifier(trashId, 'trashId'))
      if (!record) throw new Error(`Trash item not found: ${trashId}`)

      const recovery = this.startRecovery({
        operation: 'restore',
        title: `Restore ${record.title}`,
        explanation:
          'Moves an item from app Trash back to its original paths and records enough state to move it back to Trash if needed.',
        targetId: record.id,
        targetTitle: record.title,
        source: record.source,
        risk: record.risk,
        paths: [
          { label: 'App Trash folder', path: record.trashPath, role: 'trash' },
          ...record.originalPaths.map((originalPath) => ({
            label: 'Original restore path',
            path: originalPath,
            role: 'restored' as const,
          })),
        ],
      })

      try {
        await this.restoreTrashRecord(record)
        this.completeRecovery(recovery, {
          undo: {
            kind: 'restore-pre-restore-trash',
            available: true,
            label: 'Move restored item back to Trash',
          },
          metadata: { trashRecord: record, trashId: record.id },
        })
      } catch (error) {
        this.failRecovery(recovery, error)
        throw error
      }
    })
  }

  async purgeExpiredTrash(): Promise<TrashRecord[]> {
    return this.trackAsync('trash.purgeExpired', async () => {
      const retentionMs = this.requireSettings().trashRetentionDays * oneDayMs
      const now = Date.now()
      const purged: TrashRecord[] = []
      const expired = this.db.getTrash().filter((record) => {
        const deletedAt = new Date(record.deletedAt).getTime()
        return !Number.isNaN(deletedAt) && now - deletedAt > retentionMs
      })
      if (expired.length === 0) return purged

      const recovery = this.startRecovery({
        operation: 'purge-trash',
        title: `Purge ${expired.length} expired Trash item${expired.length === 1 ? '' : 's'}`,
        explanation:
          'Moves expired app Trash entries out of the active Trash list and keeps recovery checkpoints for paths that still exist.',
        risk: 'high',
        paths: expired.map((record) => ({
          label: `Expired Trash: ${record.title}`,
          path: record.trashPath,
          role: 'trash' as const,
        })),
        metadata: { trashIds: expired.map((record) => record.id) },
      })
      const checkpoints: Array<{ record: TrashRecord; checkpointPath: string }> = []
      const deletedRecords: TrashRecord[] = []

      try {
        for (const record of expired) {
          const checkpointPath = path.join(
            this.userDataPath,
            'Recovery',
            'purge-trash',
            recovery.id,
            record.id,
          )
          if (await exists(record.trashPath)) {
            await copyPath(record.trashPath, checkpointPath)
            checkpoints.push({ record, checkpointPath })
          }
          await removePath(record.trashPath)
          this.db.deleteTrashRecord(record.id)
          deletedRecords.push(record)
          purged.push(record)
        }

        this.completeRecovery(recovery, {
          paths: [
            ...recovery.paths,
            ...checkpoints.map((checkpoint) => ({
              label: `Purge checkpoint: ${checkpoint.record.title}`,
              path: checkpoint.checkpointPath,
              role: 'checkpoint' as const,
            })),
          ],
          undo: {
            kind: 'restore-purged-trash',
            available: checkpoints.length > 0,
            label: 'Recover purged items to app Trash',
            ...(checkpoints.length === 0
              ? { reason: 'No on-disk Trash paths existed when purge ran.' }
              : {}),
          },
          metadata: {
            trashIds: expired.map((record) => record.id),
            purgedTrash: checkpoints,
          },
        })
      } catch (error) {
        for (const { record, checkpointPath } of checkpoints) {
          if (!(await exists(record.trashPath)) && (await exists(checkpointPath))) {
            await copyPath(checkpointPath, record.trashPath)
          }
        }
        deletedRecords.forEach((record) => this.db.insertTrash(record))
        this.failRecovery(recovery, error, {
          metadata: {
            trashIds: expired.map((record) => record.id),
            purgedTrash: checkpoints,
          },
        })
        throw error
      }
      return purged
    })
  }

  getRecoveryRecords(): RecoveryRecord[] {
    return this.db.getRecoveryRecords()
  }

  async diagnoseRecovery(recoveryId: string): Promise<RecoveryRecord> {
    const record = this.requireRecoveryRecord(validateIdentifier(recoveryId, 'recoveryId'))
    return this.saveRecovery({
      ...record,
      diagnostics: await this.buildRecoveryDiagnostics(record),
    })
  }

  async undoRecovery(recoveryId: string): Promise<RecoveryRecord> {
    const record = this.requireRecoveryRecord(validateIdentifier(recoveryId, 'recoveryId'))
    if (record.status === 'undone') throw new Error(`Recovery already undone: ${recoveryId}`)
    if (!record.undo.available || record.undo.kind === 'none') {
      throw new Error(record.undo.reason ?? `Recovery cannot be undone: ${recoveryId}`)
    }

    const running = this.saveRecovery({
      ...record,
      status: 'running',
      steps: [...record.steps, recoveryStep(`Undo ${record.undo.label}`, 'pending')],
    })

    try {
      await this.performRecoveryUndo(running)
      const undone = {
        ...running,
        status: 'undone' as const,
        finishedAt: new Date().toISOString(),
        steps: [...running.steps, recoveryStep(`Undo ${record.undo.label}`, 'completed')],
      }
      return this.saveRecovery({
        ...undone,
        diagnostics: await this.buildRecoveryDiagnostics(undone),
      })
    } catch (error) {
      this.saveRecovery({
        ...running,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: errorMessage(error),
        steps: [...running.steps, recoveryStep(`Undo ${record.undo.label}`, 'failed')],
        diagnostics: [
          ...running.diagnostics,
          {
            level: 'error',
            code: 'undo.failed',
            message: errorMessage(error),
          },
        ],
      })
      throw error
    }
  }

  async getSkills(): Promise<SkillsSnapshot> {
    return this.trackAsync('skills.get', () => scanSkills(this.requireSettings()))
  }

  getSettings(): AppSettings {
    return this.trackSync('settings.get', () => this.requireSettings())
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    return this.trackSync('settings.update', () => {
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
    })
  }

  async openPath(targetPath: string): Promise<void> {
    return this.trackAsync('shell.openPath', async () => {
      await this.openPathHandler(normalizePath(targetPath, 'targetPath'))
    })
  }

  private startRecovery(input: RecoveryStart): RecoveryRecord {
    const startedAt = new Date().toISOString()
    const record: RecoveryRecord = {
      id: hashId([
        'recovery',
        input.operation,
        input.targetId,
        input.title,
        startedAt,
        Math.random(),
      ]),
      operation: input.operation,
      status: 'running',
      title: input.title,
      explanation: input.explanation,
      startedAt,
      targetId: input.targetId,
      targetTitle: input.targetTitle,
      source: input.source,
      risk: input.risk,
      steps: input.steps ?? [recoveryStep('Started', 'completed')],
      paths: input.paths ?? [],
      undo: input.undo ?? {
        kind: 'none',
        available: false,
        label: 'No undo available',
        reason: 'This operation has not completed yet.',
      },
      diagnostics: [],
      metadata: input.metadata ?? {},
    }
    return this.saveRecovery(record)
  }

  private completeRecovery(
    record: RecoveryRecord,
    patch: Partial<Pick<RecoveryRecord, 'paths' | 'metadata' | 'undo' | 'steps'>> = {},
  ): RecoveryRecord {
    return this.saveRecovery({
      ...record,
      ...patch,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      steps: [...(patch.steps ?? record.steps), recoveryStep('Completed', 'completed')],
    })
  }

  private failRecovery(
    record: RecoveryRecord,
    error: unknown,
    patch: Partial<Pick<RecoveryRecord, 'paths' | 'metadata' | 'steps'>> = {},
  ): void {
    this.saveRecovery({
      ...record,
      ...patch,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: errorMessage(error),
      steps: [
        ...(patch.steps ?? record.steps),
        recoveryStep('Failed', 'failed', errorMessage(error)),
      ],
      diagnostics: [
        ...record.diagnostics,
        {
          level: 'error',
          code: 'operation.failed',
          message: errorMessage(error),
        },
      ],
    })
  }

  private saveRecovery(record: RecoveryRecord): RecoveryRecord {
    this.db.upsertRecovery(record)
    return record
  }

  private requireRecoveryRecord(recoveryId: string): RecoveryRecord {
    const record = this.db.getRecoveryRecord(recoveryId)
    if (!record) throw new Error(`Recovery record not found: ${recoveryId}`)
    return record
  }

  private async buildRecoveryDiagnostics(record: RecoveryRecord): Promise<RecoveryDiagnostic[]> {
    const diagnostics: RecoveryDiagnostic[] = []

    for (const item of record.paths) {
      if (await exists(item.path)) {
        let sizeLabel: string
        try {
          sizeLabel = ` (${await pathSize(item.path)} bytes)`
        } catch {
          sizeLabel = ''
        }
        diagnostics.push({
          level: 'info',
          code: 'path.exists',
          message: `${item.label} exists${sizeLabel}.`,
          path: item.path,
        })
      } else {
        diagnostics.push({
          level: item.optional ? 'info' : 'warning',
          code: 'path.missing',
          message: `${item.label} is missing.`,
          path: item.path,
        })
      }
    }

    if (record.error) {
      diagnostics.push({
        level: 'error',
        code: 'operation.error',
        message: record.error,
      })
    }

    diagnostics.push({
      level: record.undo.available ? 'info' : 'warning',
      code: record.undo.available ? 'undo.available' : 'undo.unavailable',
      message: record.undo.available
        ? `Undo available: ${record.undo.label}.`
        : (record.undo.reason ?? 'Undo is not available for this operation.'),
    })

    return diagnostics
  }

  private metadataString(record: RecoveryRecord, key: string): string {
    const value = record.metadata[key]
    if (typeof value !== 'string' || !value) {
      throw new Error(`Recovery metadata is missing ${key}.`)
    }
    return value
  }

  private metadataRecord(record: RecoveryRecord, key: string): Record<string, unknown> {
    const value = record.metadata[key]
    if (!isRecord(value)) throw new Error(`Recovery metadata is missing ${key}.`)
    return value
  }

  private async performRecoveryUndo(record: RecoveryRecord): Promise<void> {
    switch (record.undo.kind) {
      case 'remove-created-paths': {
        const backupId =
          typeof record.metadata.backupId === 'string' ? record.metadata.backupId : undefined
        const removableRoles = new Set(['backup', 'export', 'destination', 'restored'])
        for (const item of record.paths.filter((pathItem) => removableRoles.has(pathItem.role))) {
          await removePath(item.path)
        }
        if (backupId) this.db.deleteBackupRecord(backupId)
        return
      }
      case 'restore-trash': {
        const trashIds = Array.isArray(record.metadata.trashIds)
          ? record.metadata.trashIds.filter((value): value is string => typeof value === 'string')
          : [this.metadataString(record, 'trashId')]
        let restored = 0
        for (const trashId of trashIds) {
          const trashRecord = this.db.getTrashRecord(trashId)
          if (!trashRecord) continue
          await this.restoreTrashRecord(trashRecord, false)
          restored += 1
        }
        if (restored === 0) throw new Error('No matching Trash records are available to restore.')
        await this.rescan()
        return
      }
      case 'restore-archive': {
        const archive = this.db.getArchiveRecord(this.metadataString(record, 'archiveId'))
        if (!archive) throw new Error('No matching archive record is available to restore.')
        await this.restoreArchiveRecord(archive)
        return
      }
      case 'restore-purged-trash': {
        const purgedTrash = record.metadata.purgedTrash
        if (!Array.isArray(purgedTrash)) {
          throw new Error('Recovery metadata is missing purged Trash records.')
        }
        for (const item of purgedTrash) {
          if (
            !isRecord(item) ||
            !isRecord(item.record) ||
            typeof item.checkpointPath !== 'string'
          ) {
            throw new Error('Recovery metadata has an invalid purged Trash checkpoint.')
          }
          const trashRecord = item.record as TrashRecord
          if (await exists(trashRecord.trashPath)) {
            throw new Error(
              `Cannot recover purged Trash because path exists: ${trashRecord.trashPath}`,
            )
          }
          await copyPath(item.checkpointPath, trashRecord.trashPath)
          this.db.insertTrash(trashRecord)
          await removePath(item.checkpointPath)
        }
        return
      }
      case 'restore-pre-restore-archive': {
        const archiveRecord = this.metadataRecord(record, 'archiveRecord') as ArchiveRecord
        const checkpointPath = this.metadataString(record, 'checkpointPath')
        if (await exists(archiveRecord.originalPath)) {
          const restoredHash = await hashFile(archiveRecord.originalPath)
          if (restoredHash !== archiveRecord.contentHash) {
            throw new Error(
              `Cannot undo restore because the restored file changed: ${archiveRecord.originalPath}`,
            )
          }
          await removePath(archiveRecord.originalPath)
        }
        if (await exists(archiveRecord.archivePath)) {
          throw new Error(
            `Cannot undo restore because archive path exists: ${archiveRecord.archivePath}`,
          )
        }
        await copyPath(checkpointPath, archiveRecord.archivePath)
        this.db.insertArchive(archiveRecord)
        await removePath(checkpointPath)
        await this.rescan()
        return
      }
      case 'restore-pre-restore-trash': {
        const trashRecord = this.metadataRecord(record, 'trashRecord') as TrashRecord
        if (await exists(trashRecord.trashPath)) {
          throw new Error(`Cannot undo restore because Trash path exists: ${trashRecord.trashPath}`)
        }
        await ensureDir(trashRecord.trashPath)
        for (const originalPath of trashRecord.originalPaths) {
          const target = path.join(trashRecord.trashPath, sanitizeName(path.basename(originalPath)))
          if (await exists(originalPath)) await movePath(originalPath, target)
        }
        this.db.insertTrash(trashRecord)
        await this.rescan()
        return
      }
      case 'none':
        throw new Error('Recovery has no undo action.')
      default:
        throw new Error(`Unsupported recovery undo action: ${record.undo.kind}`)
    }
  }

  private async restoreArchiveRecord(record: ArchiveRecord): Promise<void> {
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
    this.db.deleteArchiveRecord(record.id)
    await removePath(record.archivePath)
    await this.rescan()
  }

  private async restoreTrashRecord(record: TrashRecord, rescan = true): Promise<void> {
    for (const originalPath of record.originalPaths) {
      const source = path.join(record.trashPath, sanitizeName(path.basename(originalPath)))
      if (!(await exists(source))) continue
      if (await exists(originalPath)) {
        throw new Error(`Cannot restore Trash because the original path exists: ${originalPath}`)
      }
      await movePath(source, originalPath)
    }
    this.db.deleteTrashRecord(record.id)
    if (rescan) await this.rescan()
  }

  private defaultSettings(): AppSettings {
    return {
      scanRoots: {},
      cleanupRetentionDays: 7,
      trashRetentionDays: 14,
      autoBackup: true,
      mockDataEnabled: false,
      language: defaultLanguage,
      usageTimezone: defaultUsageTimezone,
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
      worktreeRoots: [],
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
      usageTimezone: normalizeTimezone(raw.usageTimezone, defaults.usageTimezone),
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
      worktreeRoots: safeWorktreeRoots(raw.worktreeRoots),
    }
  }

  private requireSettings(): AppSettings {
    if (!this.settings) throw new Error('App service is not initialized')
    return this.settings
  }

  private buildDiagnosticReport(context: DiagnosticExportContext = {}): DiagnosticReport {
    const settings = this.requireSettings()
    const operations = (
      context.recentOperations ?? this.diagnosticOperations.map(sanitizeOperation)
    )
      .slice(-maxDiagnosticOperations)
      .map(sanitizeOperation)
    const sessions = this.mergeBackupStatus(this.db.getSessions())
    const liveSessions = sessions.filter((session) => session.storageState === 'live')

    return {
      schema: diagnosticSchema,
      generatedAt: new Date().toISOString(),
      app: {
        name: 'Clean My Agent',
        version: this.appVersion,
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        v8Version: process.versions.v8,
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timezone: settings.usageTimezone,
      },
      privacy: {
        fullPaths: 'redacted',
        sessionContent: 'excluded',
        sessionMetadata: 'excluded',
        operationArguments: 'excluded',
      },
      settings: {
        language: settings.language,
        usageTimezone: settings.usageTimezone,
        scanOnLaunch: settings.scanOnLaunch,
        backgroundScan: settings.backgroundScan,
        mockDataEnabled: settings.mockDataEnabled,
        cleanupRetentionDays: settings.cleanupRetentionDays,
        trashRetentionDays: settings.trashRetentionDays,
        excludedFolderCount: settings.excludedFolders.length,
        customScanRootCount: settings.scanRoots.custom?.length ?? 0,
        enabledProviders: settings.enabledProviders,
      },
      scanSources: adapters.map((adapter) => {
        const state = this.scanStates.get(adapter.source)
        const sourceSessions = sessions.filter((session) => session.source === adapter.source)
        const liveSourceSessions = liveSessions.filter(
          (session) => session.source === adapter.source,
        )
        const roots = state?.rootPaths ?? adapter.roots(settings)
        const configuredRoots = settings.scanRoots[adapter.source] ?? []

        return {
          source: adapter.source,
          name: adapter.name,
          enabled: settings.enabledProviders[adapter.source] !== false,
          installed: state?.installed ?? false,
          readable: state?.readable ?? false,
          rootCount: roots.length,
          configuredRootCount: configuredRoots.length,
          rootIds: roots.map(diagnosticPathId).filter((item): item is string => Boolean(item)),
          sessionCount: sourceSessions.length,
          liveSessionCount: liveSourceSessions.length,
          sizeBytes: bytesFromRecords(liveSourceSessions),
          scannedFiles: state?.scannedFiles,
          skippedFiles: state?.skippedFiles,
          lastScannedAt: state?.lastScannedAt,
          diagnostics: (state?.diagnostics ?? []).map((diagnostic) => ({
            level: diagnostic.level,
            code: redactDiagnosticText(diagnostic.code),
            message: redactDiagnosticText(diagnostic.message),
            pathId: diagnosticPathId(diagnostic.path),
            count: diagnostic.count,
          })),
        }
      }),
      errorLogs: operations
        .filter((operation) => operation.status === 'error')
        .slice(-maxDiagnosticErrors),
      recentOperations: operations.slice(-maxRecentDiagnosticOperations),
      performance: summarizePerformance(operations),
    }
  }

  private recordDiagnosticOperation(operation: DiagnosticOperation): void {
    this.diagnosticOperations = [...this.diagnosticOperations, sanitizeOperation(operation)].slice(
      -maxDiagnosticOperations,
    )
  }

  private trackSync<T>(operation: string, callback: () => T): T {
    const startedAt = new Date()
    const startMs = performance.now()

    try {
      const result = callback()
      this.recordDiagnosticOperation({
        id: hashId([operation, startedAt.toISOString(), this.diagnosticOperations.length]),
        operation,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: performance.now() - startMs,
        status: 'success',
      })
      return result
    } catch (error) {
      this.recordDiagnosticOperation({
        id: hashId([operation, startedAt.toISOString(), this.diagnosticOperations.length]),
        operation,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: performance.now() - startMs,
        status: 'error',
        error: {
          name: errorName(error),
          message: errorMessage(error),
        },
      })
      throw error
    }
  }

  private async trackAsync<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    const startedAt = new Date()
    const startMs = performance.now()

    try {
      const result = await callback()
      this.recordDiagnosticOperation({
        id: hashId([operation, startedAt.toISOString(), this.diagnosticOperations.length]),
        operation,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: performance.now() - startMs,
        status: 'success',
      })
      return result
    } catch (error) {
      this.recordDiagnosticOperation({
        id: hashId([operation, startedAt.toISOString(), this.diagnosticOperations.length]),
        operation,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: performance.now() - startMs,
        status: 'error',
        error: {
          name: errorName(error),
          message: errorMessage(error),
        },
      })
      throw error
    }
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

  private async buildUniversalRelayDocument(sessionId: string): Promise<UniversalRelayDocument> {
    const session = this.requireSession(sessionId)
    const adapter = adapterFor(session.source)
    const archive =
      session.storageState === 'archived' ? this.db.getArchiveBySessionId(session.id) : undefined
    let restorePath: string | undefined

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

      return adapter.toUniversal(restorePath ? { ...session, storagePath: restorePath } : session)
    } finally {
      if (restorePath) await removePath(restorePath)
    }
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
    const timezone = this.requireSettings().usageTimezone
    const points = new Map<string, UsagePoint>()
    for (let offset = usageHistoryDays - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * oneDayMs)
      const key = dateKeyForTimezone(date, timezone)
      points.set(key, usageSeed(key))
    }

    sessions.forEach((session) => {
      if (isForkedCodexSession(session)) return

      const usageEventsByDate = usageEventsByDateFromMetadata(session.metadata, timezone)
      const usageByDate = usageEventsByDate ?? usageByDateFromMetadata(session.metadata)
      if (usageByDate && Object.keys(usageByDate).length > 0) {
        Object.entries(usageByDate).forEach(([key, tokens]) => {
          const point = points.get(key)
          if (!point) return
          point[session.source] += tokens
          point.total += tokens
        })
        return
      }

      const key = dateKeyForTimezone(new Date(session.lastUpdated), timezone)
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
