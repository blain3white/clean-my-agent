import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from './database'
import { removePath } from './files'
import type {
  ArchiveRecord,
  BackupRecord,
  RecoveryRecord,
  SessionRecord,
  TrashRecord,
} from '../../src/shared/types'

let tmpDir: string
let db: LocalDatabase

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cma-db-test-'))
  db = new LocalDatabase(path.join(tmpDir, 'test.db'))
  await db.open()
})

afterEach(async () => {
  db.close()
  await removePath(tmpDir)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    source: 'codex',
    title: 'Test Session',
    projectName: 'my-project',
    storagePath: '/tmp/sessions/session-1',
    storageKind: 'file',
    storageState: 'live',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    messageCount: 5,
    tokens: { input: 100, output: 50, cached: 0, total: 150, estimated: false },
    sizeBytes: 1024,
    backupStatus: 'unknown',
    tags: [],
    metadata: {
      parser: 'codex-v1',
      root: '/tmp',
      relativePath: 'sessions/session-1',
      sourceFormat: 'jsonl',
      usageByDate: { '2026-01-01': 10 },
      usageEvents: [{ timestamp: '2026-01-01T23:30:00.000Z', tokens: 10 }],
      relayFiles: [
        {
          path: '/tmp/project/src/app.ts',
          reason: 'Referenced by filePath',
          lastSeenAt: '2026-01-01T23:30:00.000Z',
        },
      ],
      relayCommands: [
        {
          command: 'pnpm test',
          cwd: '/tmp/project',
          createdAt: '2026-01-01T23:30:00.000Z',
        },
      ],
      gitChangedFiles: ['src/app.ts'],
      extraField: 'should be stripped',
    },
    ...overrides,
  }
}

function makeBackup(sessionId = 'session-1', id = 'backup-1'): BackupRecord {
  return {
    id,
    sessionId,
    source: 'codex',
    title: 'Backup of session-1',
    createdAt: '2026-01-02T00:00:00.000Z',
    sizeBytes: 2048,
    backupPath: '/tmp/backups/backup-1',
    originalPath: '/tmp/sessions/session-1',
    format: 'raw-copy',
  }
}

function makeArchive(sessionId = 'session-1', id = 'archive-1'): ArchiveRecord {
  const session = makeSession({ id: sessionId })
  return {
    id,
    sessionId,
    source: 'codex',
    title: 'Archive of session-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: '2026-01-03T00:00:00.000Z',
    originalPath: '/tmp/sessions/session-1',
    archivePath: '/tmp/archives/archive-1.br',
    originalBytes: 1024,
    compressedBytes: 256,
    contentHash: 'abc123',
    compression: 'brotli',
    restorable: true,
    session,
  }
}

function makeTrash(candidateId = 'candidate-1', id = 'trash-1'): TrashRecord {
  return {
    id,
    candidateId,
    title: 'Deleted session',
    source: 'codex',
    originalPaths: ['/tmp/sessions/old-session'],
    trashPath: '/tmp/trash/trash-1',
    sizeBytes: 512,
    deletedAt: '2026-01-04T00:00:00.000Z',
    risk: 'low',
    recoverable: true,
  }
}

function makeRecovery(id = 'recovery-1'): RecoveryRecord {
  return {
    id,
    operation: 'backup',
    status: 'completed',
    title: 'Backup session',
    explanation: 'Copies a session into Backups.',
    startedAt: '2026-01-05T00:00:00.000Z',
    finishedAt: '2026-01-05T00:00:01.000Z',
    targetId: 'session-1',
    targetTitle: 'Test Session',
    source: 'codex',
    risk: 'low',
    steps: [{ label: 'Completed', status: 'completed', at: '2026-01-05T00:00:01.000Z' }],
    paths: [{ label: 'Backup', path: '/tmp/backups/backup-1', role: 'backup' }],
    undo: {
      kind: 'remove-created-paths',
      available: true,
      label: 'Remove this backup',
    },
    diagnostics: [],
    metadata: { backupId: 'backup-1' },
  }
}

// ---------------------------------------------------------------------------
// open / close
// ---------------------------------------------------------------------------

describe('LocalDatabase open/close', () => {
  it('open is idempotent', async () => {
    await db.open()
    await db.open()
    expect(db.getSessions()).toEqual([])
  })

  it('throws when used before open', () => {
    const closed = new LocalDatabase(path.join(tmpDir, 'closed.db'))
    expect(() => closed.getSessions()).toThrow('Database is not open')
  })

  it('throws after close', async () => {
    db.close()
    expect(() => db.getSessions()).toThrow('Database is not open')
  })

  it('can be reopened after close', async () => {
    db.close()
    const db2 = new LocalDatabase(path.join(tmpDir, 'test.db'))
    await db2.open()
    expect(db2.getSessions()).toEqual([])
    db2.close()
    db = new LocalDatabase(path.join(tmpDir, 'test.db'))
    await db.open()
  })

  it('creates parent directories that do not yet exist', async () => {
    const nested = new LocalDatabase(path.join(tmpDir, 'a', 'b', 'c', 'nested.db'))
    await nested.open()
    expect(nested.getSessions()).toEqual([])
    nested.close()
  })
})

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

describe('settings', () => {
  it('returns undefined for unknown key', () => {
    expect(db.getSetting('no-such-key')).toBeUndefined()
  })

  it('persists and retrieves a string value', () => {
    db.setSetting('theme', 'dark')
    expect(db.getSetting<string>('theme')).toBe('dark')
  })

  it('persists and retrieves a complex object', () => {
    const val = { scanRoots: { codex: ['/home/user/.codex'] }, autoBackup: true }
    db.setSetting('app-settings', val)
    expect(db.getSetting('app-settings')).toEqual(val)
  })

  it('upserts: later write wins', () => {
    db.setSetting('key', 'first')
    db.setSetting('key', 'second')
    expect(db.getSetting<string>('key')).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// replaceSessions vs upsertSessions
// ---------------------------------------------------------------------------

describe('replaceSessions', () => {
  it('inserts sessions and retrieves them', () => {
    const s = makeSession()
    db.replaceSessions([s])
    expect(db.getSessions()).toHaveLength(1)
    expect(db.getSessions()[0].id).toBe('session-1')
  })

  it('replaces the entire set (clears previous rows)', () => {
    db.replaceSessions([makeSession({ id: 'old' })])
    db.replaceSessions([makeSession({ id: 'new' })])
    const sessions = db.getSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('new')
  })

  it('handles empty array by clearing all sessions', () => {
    db.replaceSessions([makeSession()])
    db.replaceSessions([])
    expect(db.getSessions()).toHaveLength(0)
  })

  it('updates existing session when called twice with same id', () => {
    db.replaceSessions([makeSession({ title: 'Old Title' })])
    db.replaceSessions([makeSession({ title: 'New Title' })])
    expect(db.getSessions()[0].title).toBe('New Title')
  })
})

describe('upsertSessions', () => {
  it('inserts new sessions without clearing existing ones', () => {
    db.replaceSessions([makeSession({ id: 'a' })])
    db.upsertSessions([makeSession({ id: 'b' })])
    expect(db.getSessions()).toHaveLength(2)
  })

  it('updates an existing session when id collides', () => {
    db.replaceSessions([makeSession({ title: 'Before' })])
    db.upsertSessions([makeSession({ title: 'After' })])
    const sessions = db.getSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('After')
  })

  it('is a no-op for empty array', () => {
    db.replaceSessions([makeSession()])
    db.upsertSessions([])
    expect(db.getSessions()).toHaveLength(1)
  })
})

describe('reconcileScannedSessions', () => {
  it('keeps deleted history while replacing stale active sessions', () => {
    db.replaceSessions([
      makeSession({ id: 'deleted', storageState: 'deleted' }),
      makeSession({ id: 'stale-live' }),
    ])

    db.reconcileScannedSessions([makeSession({ id: 'fresh-live' })])

    expect(
      db
        .getSessions()
        .map((session) => session.id)
        .sort(),
    ).toEqual(['deleted', 'fresh-live'])
  })

  it('restores a deleted record to live when the scanner finds the same id again', () => {
    db.replaceSessions([makeSession({ storageState: 'deleted' })])

    db.reconcileScannedSessions([makeSession({ storageState: 'live', title: 'Restored' })])

    expect(db.getSession('session-1')).toMatchObject({
      storageState: 'live',
      title: 'Restored',
    })
  })
})

describe('getSession', () => {
  it('returns undefined for unknown id', () => {
    expect(db.getSession('missing')).toBeUndefined()
  })

  it('returns the session for a known id', () => {
    db.replaceSessions([makeSession()])
    expect(db.getSession('session-1')?.id).toBe('session-1')
  })
})

// ---------------------------------------------------------------------------
// compactSessionForStorage — verified through round-trip reads
// ---------------------------------------------------------------------------

describe('compactSessionForStorage behavior', () => {
  it('preserves parser, root, usage, and report metadata', () => {
    db.replaceSessions([makeSession()])
    const stored = db.getSession('session-1')!
    expect(stored.metadata.parser).toBe('codex-v1')
    expect(stored.metadata.root).toBe('/tmp')
    expect(stored.metadata.relativePath).toBe('sessions/session-1')
    expect(stored.metadata.sourceFormat).toBe('jsonl')
    expect(stored.metadata.usageByDate).toEqual({ '2026-01-01': 10 })
    expect(stored.metadata.usageEvents).toEqual([
      { timestamp: '2026-01-01T23:30:00.000Z', tokens: 10 },
    ])
    expect(stored.metadata.relayFiles).toEqual([
      {
        path: '/tmp/project/src/app.ts',
        reason: 'Referenced by filePath',
        lastSeenAt: '2026-01-01T23:30:00.000Z',
      },
    ])
    expect(stored.metadata.relayCommands).toEqual([
      {
        command: 'pnpm test',
        cwd: '/tmp/project',
        createdAt: '2026-01-01T23:30:00.000Z',
      },
    ])
    expect(stored.metadata.gitChangedFiles).toEqual(['src/app.ts'])
  })

  it('strips extra metadata fields', () => {
    db.replaceSessions([makeSession()])
    const stored = db.getSession('session-1')!
    expect(stored.metadata).not.toHaveProperty('extraField')
  })

  it('preserves all top-level session fields unchanged', () => {
    const s = makeSession()
    db.replaceSessions([s])
    const stored = db.getSession('session-1')!
    expect(stored.id).toBe(s.id)
    expect(stored.title).toBe(s.title)
    expect(stored.sizeBytes).toBe(s.sizeBytes)
    expect(stored.tokens).toEqual(s.tokens)
  })

  it('retains metadata even when optional fields are absent', () => {
    const s = makeSession()
    s.metadata = {
      parser: 'minimal',
      root: '/r',
      relativePath: 'rel',
      sourceFormat: 'jsonl',
      usageByDate: {},
    }
    db.replaceSessions([s])
    const stored = db.getSession('session-1')!
    expect(stored.metadata).toEqual({
      parser: 'minimal',
      root: '/r',
      relativePath: 'rel',
      sourceFormat: 'jsonl',
      usageByDate: {},
    })
  })
})

// ---------------------------------------------------------------------------
// Backup CRUD
// ---------------------------------------------------------------------------

describe('backup CRUD', () => {
  it('starts empty', () => {
    expect(db.getBackups()).toEqual([])
  })

  it('inserts and retrieves a backup', () => {
    db.insertBackup(makeBackup())
    const backups = db.getBackups()
    expect(backups).toHaveLength(1)
    expect(backups[0].id).toBe('backup-1')
  })

  it('upserts on duplicate id', () => {
    db.insertBackup(makeBackup())
    db.insertBackup({ ...makeBackup(), sizeBytes: 9999 })
    const backups = db.getBackups()
    expect(backups).toHaveLength(1)
    expect(backups[0].sizeBytes).toBe(9999)
  })

  it('returns backups ordered by created_at DESC', () => {
    db.insertBackup(makeBackup('s1', 'b1'))
    db.insertBackup({ ...makeBackup('s2', 'b2'), createdAt: '2026-02-01T00:00:00.000Z' })
    const backups = db.getBackups()
    expect(backups[0].id).toBe('b2')
    expect(backups[1].id).toBe('b1')
  })

  it('deletes a backup record', () => {
    db.insertBackup(makeBackup())
    db.deleteBackupRecord('backup-1')
    expect(db.getBackups()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Archive CRUD
// ---------------------------------------------------------------------------

describe('archive CRUD', () => {
  it('starts empty', () => {
    expect(db.getArchives()).toEqual([])
  })

  it('inserts and retrieves an archive', () => {
    db.insertArchive(makeArchive())
    expect(db.getArchives()).toHaveLength(1)
    expect(db.getArchives()[0].id).toBe('archive-1')
  })

  it('getArchiveRecord returns undefined for unknown id', () => {
    expect(db.getArchiveRecord('missing')).toBeUndefined()
  })

  it('getArchiveRecord returns archive by id', () => {
    db.insertArchive(makeArchive())
    expect(db.getArchiveRecord('archive-1')?.id).toBe('archive-1')
  })

  it('getArchiveBySessionId returns the latest archive for a session', () => {
    db.insertArchive(makeArchive('s1', 'a1'))
    db.insertArchive({ ...makeArchive('s1', 'a2'), archivedAt: '2026-06-01T00:00:00.000Z' })
    const found = db.getArchiveBySessionId('s1')
    expect(found?.id).toBe('a2')
  })

  it('getArchiveBySessionId returns undefined for unknown session', () => {
    expect(db.getArchiveBySessionId('no-such-session')).toBeUndefined()
  })

  it('deletes an archive record', () => {
    db.insertArchive(makeArchive())
    db.deleteArchiveRecord('archive-1')
    expect(db.getArchiveRecord('archive-1')).toBeUndefined()
    expect(db.getArchives()).toHaveLength(0)
  })

  it('deleteArchiveRecord is a no-op for unknown id', () => {
    db.insertArchive(makeArchive())
    db.deleteArchiveRecord('ghost')
    expect(db.getArchives()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Trash CRUD
// ---------------------------------------------------------------------------

describe('trash CRUD', () => {
  it('starts empty', () => {
    expect(db.getTrash()).toEqual([])
  })

  it('inserts and retrieves a trash record', () => {
    db.insertTrash(makeTrash())
    expect(db.getTrash()).toHaveLength(1)
    expect(db.getTrash()[0].id).toBe('trash-1')
  })

  it('getTrashRecord returns undefined for unknown id', () => {
    expect(db.getTrashRecord('missing')).toBeUndefined()
  })

  it('getTrashRecord returns record by id', () => {
    db.insertTrash(makeTrash())
    expect(db.getTrashRecord('trash-1')?.id).toBe('trash-1')
  })

  it('upserts on duplicate id', () => {
    db.insertTrash(makeTrash())
    db.insertTrash({ ...makeTrash(), sizeBytes: 8888 })
    const trash = db.getTrash()
    expect(trash).toHaveLength(1)
    expect(trash[0].sizeBytes).toBe(8888)
  })

  it('returns trash ordered by deleted_at DESC', () => {
    db.insertTrash(makeTrash('c1', 't1'))
    db.insertTrash({ ...makeTrash('c2', 't2'), deletedAt: '2026-12-01T00:00:00.000Z' })
    const trash = db.getTrash()
    expect(trash[0].id).toBe('t2')
    expect(trash[1].id).toBe('t1')
  })

  it('deletes a trash record', () => {
    db.insertTrash(makeTrash())
    db.deleteTrashRecord('trash-1')
    expect(db.getTrashRecord('trash-1')).toBeUndefined()
    expect(db.getTrash()).toHaveLength(0)
  })

  it('deleteTrashRecord is a no-op for unknown id', () => {
    db.insertTrash(makeTrash())
    db.deleteTrashRecord('ghost')
    expect(db.getTrash()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Recovery CRUD
// ---------------------------------------------------------------------------

describe('recovery CRUD', () => {
  it('starts empty', () => {
    expect(db.getRecoveryRecords()).toEqual([])
  })

  it('upserts and retrieves recovery records', () => {
    db.upsertRecovery(makeRecovery())
    db.upsertRecovery({ ...makeRecovery(), status: 'failed', error: 'boom' })

    const records = db.getRecoveryRecords()
    expect(records).toHaveLength(1)
    expect(records[0].status).toBe('failed')
    expect(db.getRecoveryRecord('recovery-1')?.error).toBe('boom')
  })

  it('returns recovery records ordered by started_at DESC', () => {
    db.upsertRecovery(makeRecovery('old'))
    db.upsertRecovery({
      ...makeRecovery('new'),
      startedAt: '2026-02-01T00:00:00.000Z',
    })

    expect(db.getRecoveryRecords().map((record) => record.id)).toEqual(['new', 'old'])
  })

  it('returns undefined for unknown recovery id', () => {
    expect(db.getRecoveryRecord('missing')).toBeUndefined()
  })
})
