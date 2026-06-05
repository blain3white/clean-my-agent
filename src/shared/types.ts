export const agentSources = ['codex', 'claude', 'cursor', 'gemini', 'opencode'] as const

export type AgentSource = (typeof agentSources)[number]

export type BackupStatus = 'backed-up' | 'pending' | 'unknown'

export type SessionStorageState = 'live' | 'archived'

export type RiskLevel = 'low' | 'medium' | 'high'

export type TokenCostSource = 'actual' | 'model-estimate' | 'mixed'

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
  lastScannedAt?: string
  note?: string
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

export type UsagePoint = {
  date: string
  codex: number
  claude: number
  cursor: number
  gemini: number
  opencode: number
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
  usage: UsagePoint[]
  storage: StorageSlice[]
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

export type ExportFormat = 'json' | 'markdown' | 'universal-json'

export type AppSettings = {
  scanRoots: Partial<Record<AgentSource, string[]>>
  cleanupRetentionDays: number
  trashRetentionDays: number
  autoBackup: boolean
  mockDataEnabled: boolean
  defaultRelayMode: 'full-context' | 'fit-to-window' | 'manual-select'
  exportDirectory: string
}

export type ThemePreference = 'system' | 'light' | 'dark'

export type CleanMyAgentApi = {
  getSnapshot: () => Promise<DashboardSnapshot>
  rescan: () => Promise<DashboardSnapshot>
  refreshRecentSessions: () => Promise<DashboardSnapshot>
  backupSession: (sessionId: string) => Promise<BackupRecord>
  archiveSession: (sessionId: string) => Promise<ArchiveRecord>
  restoreArchive: (archiveId: string) => Promise<void>
  exportSession: (sessionId: string, format: ExportFormat) => Promise<string>
  scanCleanup: () => Promise<CleanupCandidate[]>
  moveCleanupToTrash: (candidateIds: string[]) => Promise<TrashRecord[]>
  restoreTrash: (trashId: string) => Promise<void>
  exportUniversalRelay: (sessionId: string) => Promise<string>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  openPath: (path: string) => Promise<void>
}
