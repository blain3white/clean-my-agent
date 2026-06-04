import type { BackupRecord, SessionRecord, TrashRecord } from '../../src/shared/types'
import { ensureDir } from './files'
import path from 'node:path'

type Statement = {
  run: (...values: unknown[]) => unknown
  all: (...values: unknown[]) => Array<Record<string, unknown>>
  get: (...values: unknown[]) => Record<string, unknown> | undefined
}

type DatabaseSync = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
  close: () => void
}

type SqliteModule = {
  DatabaseSync: new (path: string) => DatabaseSync
}

function compactSessionForStorage(session: SessionRecord): SessionRecord {
  return {
    ...session,
    metadata: {
      parser: session.metadata.parser,
      root: session.metadata.root,
      relativePath: session.metadata.relativePath,
      sourceFormat: session.metadata.sourceFormat,
      usageByDate: session.metadata.usageByDate,
    },
  }
}

export class LocalDatabase {
  private db?: DatabaseSync
  private readonly dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  async open(): Promise<void> {
    if (this.db) return
    await ensureDir(path.dirname(this.dbPath))
    const sqlite = (await import('node:sqlite')) as unknown as SqliteModule
    this.db = new sqlite.DatabaseSync(this.dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        last_updated TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trash (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  close(): void {
    this.db?.close()
    this.db = undefined
  }

  replaceSessions(sessions: SessionRecord[]): void {
    const db = this.requireDb()
    const statement = db.prepare(`
      INSERT INTO sessions (id, source, last_updated, size_bytes, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        last_updated = excluded.last_updated,
        size_bytes = excluded.size_bytes,
        data = excluded.data
    `)
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM sessions').run()
      sessions.forEach((session) => {
        statement.run(
          session.id,
          session.source,
          session.lastUpdated,
          session.sizeBytes,
          JSON.stringify(compactSessionForStorage(session)),
        )
      })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  getSessions(): SessionRecord[] {
    const rows = this.requireDb().prepare('SELECT data FROM sessions ORDER BY last_updated DESC').all()
    return rows.map((row) => JSON.parse(String(row.data)) as SessionRecord)
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.requireDb().prepare('SELECT data FROM sessions WHERE id = ?').get(id)
    return row ? (JSON.parse(String(row.data)) as SessionRecord) : undefined
  }

  insertBackup(record: BackupRecord): void {
    this.requireDb()
      .prepare(
        `INSERT OR REPLACE INTO backups (id, session_id, source, created_at, size_bytes, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(record.id, record.sessionId, record.source, record.createdAt, record.sizeBytes, JSON.stringify(record))
  }

  getBackups(): BackupRecord[] {
    const rows = this.requireDb().prepare('SELECT data FROM backups ORDER BY created_at DESC').all()
    return rows.map((row) => JSON.parse(String(row.data)) as BackupRecord)
  }

  insertTrash(record: TrashRecord): void {
    this.requireDb()
      .prepare(
        `INSERT OR REPLACE INTO trash (id, candidate_id, deleted_at, size_bytes, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(record.id, record.candidateId, record.deletedAt, record.sizeBytes, JSON.stringify(record))
  }

  getTrash(): TrashRecord[] {
    const rows = this.requireDb().prepare('SELECT data FROM trash ORDER BY deleted_at DESC').all()
    return rows.map((row) => JSON.parse(String(row.data)) as TrashRecord)
  }

  getTrashRecord(id: string): TrashRecord | undefined {
    const row = this.requireDb().prepare('SELECT data FROM trash WHERE id = ?').get(id)
    return row ? (JSON.parse(String(row.data)) as TrashRecord) : undefined
  }

  deleteTrashRecord(id: string): void {
    this.requireDb().prepare('DELETE FROM trash WHERE id = ?').run(id)
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.requireDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? (JSON.parse(String(row.value)) as T) : undefined
  }

  setSetting(key: string, value: unknown): void {
    this.requireDb()
      .prepare(
        `INSERT INTO settings (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value))
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error('Database is not open')
    return this.db
  }
}
