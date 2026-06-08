export const agentSources = ['codex', 'claude', 'cursor', 'gemini', 'opencode', 'custom'] as const

export type AgentSource = (typeof agentSources)[number]

export const appLanguages = ['en', 'zh-CN', 'ja', 'fr'] as const

export type AppLanguage = (typeof appLanguages)[number]

export const defaultLanguage: AppLanguage = 'en'

export type BackupStatus = 'backed-up' | 'pending' | 'unknown'

export type SessionStorageState = 'live' | 'archived'

export type RiskLevel = 'low' | 'medium' | 'high'

export type TokenCostSource = 'actual' | 'model-estimate' | 'mixed'

export type AgentScanDiagnostic = {
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
  path?: string
  count?: number
}

export type TokenUsage = {
  input: number
  output: number
  cached: number
  cacheCreation?: number
  cacheRead?: number
  total: number
  costUsd?: number
  costSource?: TokenCostSource
  model?: string
  estimated: boolean
}

export type AgentInstallState = {
  source: AgentSource
  name: string
  installed: boolean
  readable: boolean
  rootPaths: string[]
  sessionCount: number
  sizeBytes: number
  scannedFiles?: number
  skippedFiles?: number
  lastScannedAt?: string
  note?: string
  diagnostics?: AgentScanDiagnostic[]
}

export type SessionRecord = {
  id: string
  source: AgentSource
  title: string
  projectName: string
  projectPath?: string
  branch?: string
  storagePath: string
  storageKind: 'file' | 'directory' | 'database'
  storageState: SessionStorageState
  createdAt?: string
  lastUpdated: string
  messageCount: number
  tokens: TokenUsage
  sizeBytes: number
  backupStatus: BackupStatus
  tags: string[]
  searchText?: string
  metadata: Record<string, unknown>
}

export type ArchiveRecord = {
  id: string
  sessionId: string
  source: AgentSource
  title: string
  createdAt: string
  archivedAt: string
  originalPath: string
  archivePath: string
  originalBytes: number
  compressedBytes: number
  contentHash: string
  compression: 'brotli'
  restorable: boolean
  session: SessionRecord
}

export type BackupRecord = {
  id: string
  sessionId: string
  source: AgentSource
  title: string
  createdAt: string
  sizeBytes: number
  backupPath: string
  originalPath: string
  format: 'raw-copy' | 'universal-json'
}

export type CleanupKind =
  | 'old-session'
  | 'backed-up-session'
  | 'large-log'
  | 'duplicate-backup'
  | 'temp-file'
  | 'orphan-session'
  | 'invalid-cache'

export type CleanupCandidate = {
  id: string
  kind: CleanupKind
  title: string
  source?: AgentSource
  sessionIds: string[]
  paths: string[]
  sizeBytes: number
  lastUpdated?: string
  reason: string
  risk: RiskLevel
  recoverable: boolean
  backedUp: boolean
}

export type TrashRecord = {
  id: string
  candidateId: string
  title: string
  source?: AgentSource
  originalPaths: string[]
  trashPath: string
  sizeBytes: number
  deletedAt: string
  risk: RiskLevel
  recoverable: boolean
}

export type RecoveryOperation =
  | 'backup'
  | 'archive'
  | 'restore'
  | 'export'
  | 'trash'
  | 'purge-trash'

export type RecoveryStatus = 'running' | 'completed' | 'failed' | 'undone'

export type RecoveryStepStatus = 'pending' | 'completed' | 'failed' | 'skipped'

export type RecoveryStep = {
  label: string
  status: RecoveryStepStatus
  at?: string
  detail?: string
}

export type RecoveryPathRole =
  | 'source'
  | 'destination'
  | 'checkpoint'
  | 'backup'
  | 'export'
  | 'trash'
  | 'restored'

export type RecoveryPath = {
  label: string
  path: string
  role: RecoveryPathRole
  optional?: boolean
}

export type RecoveryDiagnostic = {
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
  path?: string
}

export type RecoveryUndoKind =
  | 'none'
  | 'remove-created-paths'
  | 'restore-trash'
  | 'restore-archive'
  | 'restore-purged-trash'
  | 'restore-pre-restore-archive'
  | 'restore-pre-restore-trash'

export type RecoveryUndo = {
  kind: RecoveryUndoKind
  available: boolean
  label: string
  reason?: string
}

export type RecoveryRecord = {
  id: string
  operation: RecoveryOperation
  status: RecoveryStatus
  title: string
  explanation: string
  startedAt: string
  finishedAt?: string
  targetId?: string
  targetTitle?: string
  source?: AgentSource
  risk?: RiskLevel
  steps: RecoveryStep[]
  paths: RecoveryPath[]
  undo: RecoveryUndo
  diagnostics: RecoveryDiagnostic[]
  error?: string
  metadata: Record<string, unknown>
}

export type UsagePoint = {
  date: string
  codex: number
  claude: number
  cursor: number
  gemini: number
  opencode: number
  custom: number
  total: number
}

export type StorageSlice = {
  source: AgentSource | 'archives' | 'backups' | 'trash' | 'logs' | 'cache'
  label: string
  sizeBytes: number
  sessions?: number
}

export type DashboardOverview = {
  totalSessions: number
  backedUpSessions: number
  reclaimableBytes: number
  lastBackupAt?: string
  totalTokens: number
  totalCostUsd?: number
  totalSizeBytes: number
  highRiskCleanupCount: number
}

export type DashboardSnapshot = {
  generatedAt: string
  overview: DashboardOverview
  agents: AgentInstallState[]
  sessions: SessionRecord[]
  cleanup: CleanupCandidate[]
  archives: ArchiveRecord[]
  backups: BackupRecord[]
  trash: TrashRecord[]
  recovery: RecoveryRecord[]
  usage: UsagePoint[]
  storage: StorageSlice[]
}

export type SkillStatus = 'synced' | 'local' | 'backed-up'

export type SkillCategory = 'engineering' | 'docs' | 'productivity' | 'design' | 'data'

export type ManagedSkill = {
  id: string
  name: string
  description: string
  content: string
  ownerAgent: AgentSource
  category: SkillCategory
  updatedAt: string
  sizeKb: number
  status: SkillStatus
  linkedAgents: AgentSource[]
  version: string
  createdAt: string
  lastBackupAt?: string
  usageCount: number
  location: string
  accent: 'violet' | 'orange' | 'green' | 'blue' | 'cyan' | 'pink' | 'amber'
  icon: 'code' | 'review' | 'bug' | 'notes' | 'search' | 'image' | 'data' | 'spec'
}

export type SkillsSummary = {
  totalSkills: number
  weeklyDelta: number
  linkedAgents: number
  linkedAgentTotal: number
  backups: number
  backupPercent: number
  recentlyChanged: number
}

export type SkillsSnapshot = {
  generatedAt: string
  skills: ManagedSkill[]
  summary: SkillsSummary
}

export type UniversalRelayMessage = {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool' | 'unknown'
  createdAt?: string
  text: string
  raw?: unknown
}

export type UniversalRelayDocument = {
  schema: 'clean-my-agent.universal-session.v1'
  exportedAt: string
  source: AgentSource
  session: SessionRecord
  messages: UniversalRelayMessage[]
  files: Array<{ path: string; reason: string; lastSeenAt?: string }>
  commands: Array<{ command: string; cwd?: string; createdAt?: string }>
  git?: {
    branch?: string
    projectPath?: string
    diff?: string
  }
  attachments: Array<{ path: string; mediaType?: string; sizeBytes?: number }>
  warnings: string[]
}

export const exportFormats = ['json', 'markdown', 'universal-json'] as const

export type ExportFormat = (typeof exportFormats)[number]

export type AppSettings = {
  scanRoots: Partial<Record<AgentSource, string[]>>
  cleanupRetentionDays: number
  trashRetentionDays: number
  autoBackup: boolean
  mockDataEnabled: boolean
  language: AppLanguage
  usageTimezone: string
  launchAtLogin: boolean
  enabledProviders: Partial<Record<AgentSource, boolean>>
  scanOnLaunch: boolean
  backgroundScan: boolean
  confirmBeforeCleanup: boolean
  excludedFolders: string[]
  soundEffects: boolean
  cleanupSound: boolean
  scanSound: boolean
  errorSound: boolean
  soundVolume: number
  checkForUpdates: boolean
  defaultRelayMode: 'full-context' | 'fit-to-window' | 'manual-select'
  exportDirectory: string
}

export type ThemePreference = 'system' | 'light' | 'dark'

export type UpdateReleaseAsset = {
  name: string
  sizeBytes: number
  downloadUrl: string
}

export type UpdateReleaseCheckResult = {
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseUrl: string
  publishedAt?: string
  available: boolean
  asset?: UpdateReleaseAsset
}

export type UpdateDownloadResult = UpdateReleaseCheckResult & {
  downloadedPath?: string
  downloadedBytes?: number
}

export type DiagnosticOperationStatus = 'success' | 'error'

export type DiagnosticOperation = {
  id: string
  operation: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: DiagnosticOperationStatus
  error?: {
    name: string
    message: string
  }
}

export type DiagnosticPerformanceMetric = {
  operation: string
  count: number
  errorCount: number
  averageDurationMs: number
  maxDurationMs: number
  lastDurationMs: number
  lastFinishedAt: string
}

export type DiagnosticReport = {
  schema: 'clean-my-agent.diagnostic-report.v1'
  generatedAt: string
  app: {
    name: string
    version: string
    nodeVersion: string
    electronVersion?: string
    chromeVersion?: string
    v8Version?: string
  }
  system: {
    platform: string
    arch: string
    release: string
    cpuCount: number
    totalMemoryBytes: number
    freeMemoryBytes: number
    locale: string
    timezone: string
  }
  privacy: {
    fullPaths: 'redacted'
    sessionContent: 'excluded'
    sessionMetadata: 'excluded'
    operationArguments: 'excluded'
  }
  settings: {
    language: AppLanguage
    usageTimezone: string
    scanOnLaunch: boolean
    backgroundScan: boolean
    mockDataEnabled: boolean
    cleanupRetentionDays: number
    trashRetentionDays: number
    excludedFolderCount: number
    customScanRootCount: number
    enabledProviders: Partial<Record<AgentSource, boolean>>
  }
  scanSources: Array<{
    source: AgentSource
    name: string
    enabled: boolean
    installed: boolean
    readable: boolean
    rootCount: number
    configuredRootCount: number
    rootIds: string[]
    sessionCount: number
    liveSessionCount: number
    sizeBytes: number
    scannedFiles?: number
    skippedFiles?: number
    lastScannedAt?: string
    diagnostics: Array<{
      level: AgentScanDiagnostic['level']
      code: string
      message: string
      pathId?: string
      count?: number
    }>
  }>
  errorLogs: DiagnosticOperation[]
  recentOperations: DiagnosticOperation[]
  performance: DiagnosticPerformanceMetric[]
}

export type CleanMyAgentApi = {
  getSnapshot: () => Promise<DashboardSnapshot>
  rescan: () => Promise<DashboardSnapshot>
  refreshRecentSessions: () => Promise<DashboardSnapshot>
  getSessionDetail: (sessionId: string) => Promise<UniversalRelayDocument>
  getSkills: () => Promise<SkillsSnapshot>
  backupSession: (sessionId: string) => Promise<BackupRecord>
  archiveSession: (sessionId: string) => Promise<ArchiveRecord>
  restoreArchive: (archiveId: string) => Promise<void>
  exportSession: (sessionId: string, format: ExportFormat) => Promise<string>
  scanCleanup: () => Promise<CleanupCandidate[]>
  moveCleanupToTrash: (candidateIds: string[]) => Promise<TrashRecord[]>
  purgeExpiredTrash: () => Promise<TrashRecord[]>
  restoreTrash: (trashId: string) => Promise<void>
  getRecoveryRecords: () => Promise<RecoveryRecord[]>
  diagnoseRecovery: (recoveryId: string) => Promise<RecoveryRecord>
  undoRecovery: (recoveryId: string) => Promise<RecoveryRecord>
  exportUniversalRelay: (sessionId: string) => Promise<string>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  chooseFolders: () => Promise<string[]>
  openPath: (path: string) => Promise<void>
  playSystemSound: () => Promise<void>
  exportDiagnostics: () => Promise<string>
  getLaunchAtLogin: () => Promise<boolean>
  setLaunchAtLogin: (enabled: boolean) => Promise<boolean>
  checkForUpdates: () => Promise<UpdateReleaseCheckResult>
  downloadLatestUpdate: () => Promise<UpdateDownloadResult>
}
