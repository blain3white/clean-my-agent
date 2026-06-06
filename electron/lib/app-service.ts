import path from 'node:path'
import type {
  AgentSource,
  AppLanguage,
  ArchiveRecord,
  AppSettings,
  BackupRecord,
  CleanupCandidate,
  DashboardSnapshot,
  ExportFormat,
  SessionRecord,
  StorageSlice,
  TrashRecord,
  UsagePoint,
} from '../../src/shared/types'
import { appLanguages, defaultLanguage } from '../../src/shared/types'
import { adapters, adapterFor } from './adapters'
import { LocalDatabase } from './database'
import {
  compressFileBrotli,
  copyPath,
  decompressFileBrotli,
  ensureDir,
  exists,
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
const agentLabels: Record<AgentSource, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function bytesFromRecords(records: Array<{ sizeBytes: number }>): number {
  return records.reduce((total, record) => total + record.sizeBytes, 0)
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
    if (forceRescan || this.shouldRescanCachedSessions()) {
      await this.rescan()
    }

    const archives = this.db.getArchives()
    const sessions = this.mergeBackupStatus([
      ...this.db.getSessions(),
      ...this.sessionsFromArchives(archives),
    ])
    const backups = this.db.getBackups()
    const trash = this.db.getTrash()
    const liveSessions = sessions.filter((session) => session.storageState === 'live')
    const cleanup = this.buildCleanupCandidates(liveSessions, backups)
    const agents = await Promise.all(
      adapters.map(async (adapter) => {
        const sourceSessions = sessions.filter((session) => session.source === adapter.source)
        const liveSourceSessions = sourceSessions.filter(
          (session) => session.storageState === 'live',
        )
        return {
          source: adapter.source,
          name: adapter.name,
          installed: sourceSessions.length > 0,
          readable: sourceSessions.length > 0,
          rootPaths: adapter.roots(this.requireSettings()),
          sessionCount: sourceSessions.length,
          sizeBytes: bytesFromRecords(liveSourceSessions),
          lastScannedAt: new Date().toISOString(),
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
    const results = await Promise.all(adapters.map((adapter) => adapter.scan(settings)))
    const sessions = results.flatMap((result) => result.sessions)
    this.db.replaceSessions(this.mergeBackupStatus(sessions))
    this.db.setSetting('scanSchemaVersion', scanSchemaVersion)
    return this.getSnapshot(false)
  }

  async refreshRecentSessions(limit = 10): Promise<DashboardSnapshot> {
    const settings = this.requireSettings()
    const candidateGroups = await Promise.all(
      adapters.map(async (adapter) => ({
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
    const session = this.requireSession(sessionId)
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
    const session = this.requireSession(sessionId)
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
    const record = this.db.getArchiveRecord(archiveId)
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
    const session = this.requireSession(sessionId)
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
    const session = this.requireSession(sessionId)
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
    return this.buildCleanupCandidates(
      this.mergeBackupStatus(this.db.getSessions()),
      this.db.getBackups(),
    )
  }

  async moveCleanupToTrash(candidateIds: string[]): Promise<TrashRecord[]> {
    const candidates = await this.scanCleanup()
    const selected = candidates.filter((candidate) => candidateIds.includes(candidate.id))
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
    const record = this.db.getTrashRecord(trashId)
    if (!record) throw new Error(`Trash item not found: ${trashId}`)

    for (const originalPath of record.originalPaths) {
      const source = path.join(record.trashPath, sanitizeName(path.basename(originalPath)))
      if (await exists(source)) await movePath(source, originalPath)
    }
    this.db.deleteTrashRecord(trashId)
    await this.rescan()
  }

  getSettings(): AppSettings {
    return this.requireSettings()
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.requireSettings()
    const next = this.mergeSettings({
      ...current,
      ...patch,
      scanRoots: {
        ...current.scanRoots,
        ...patch.scanRoots,
      },
    })
    this.settings = next
    this.db.setSetting('settings', next)
    return next
  }

  async openPath(targetPath: string): Promise<void> {
    await this.openPathHandler(targetPath)
  }

  private defaultSettings(): AppSettings {
    return {
      scanRoots: {},
      cleanupRetentionDays: 30,
      trashRetentionDays: 14,
      autoBackup: true,
      mockDataEnabled: false,
      language: defaultLanguage,
      launchAtLogin: false,
      defaultRelayMode: 'full-context',
      exportDirectory: path.join(this.userDataPath, 'Exports'),
    }
  }

  private mergeSettings(settings?: Partial<AppSettings>): AppSettings {
    const defaults = this.defaultSettings()
    return {
      ...defaults,
      ...settings,
      language: appLanguages.includes(settings?.language as AppLanguage)
        ? (settings?.language as AppLanguage)
        : defaults.language,
      scanRoots: {
        ...defaults.scanRoots,
        ...settings?.scanRoots,
      },
      exportDirectory: settings?.exportDirectory || defaults.exportDirectory,
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
      points.set(key, {
        date: key,
        codex: 0,
        claude: 0,
        cursor: 0,
        gemini: 0,
        opencode: 0,
        total: 0,
      })
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
