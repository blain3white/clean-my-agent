import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { AppService } from '../electron/lib/app-service'
import type { AgentSource } from '../src/shared/types'

const sources: AgentSource[] = ['codex', 'claude', 'cursor', 'gemini', 'opencode']

async function writeSession(root: string, source: AgentSource, daysOld: number) {
  const dir = path.join(root, source)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${source}-session.jsonl`)
  const workspace = path.join('/tmp', 'clean-my-agent-fixture', source)
  const date = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)
  const timestamp = date.toISOString()
  const lines = [
    {
      role: 'user',
      timestamp,
      content: `Refactor ${source} auth flow`,
      cwd: workspace,
      branch: 'main',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10 },
      costUSD: 0.25,
    },
    {
      role: 'assistant',
      timestamp,
      content: `Finished ${source} refactor`,
      message: {
        id: `${source}-assistant-1`,
        usage: { input_tokens: 30, output_tokens: 80, cache_creation_input_tokens: 2000 },
      },
      costUSD: 0.5,
    },
    {
      type: 'event_msg',
      timestamp,
      payload: {
        type: 'token_count',
        last_token_usage: {
          input_tokens: 40,
          cached_input_tokens: 20,
          output_tokens: 30,
          total_tokens: 70,
        },
      },
    },
  ]
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  await utimes(filePath, date, date)
  return filePath
}

async function main() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-fixture-'))
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-user-data-'))
  const files = new Map<AgentSource, string>()

  for (const source of sources) {
    files.set(source, await writeSession(fixtureRoot, source, 45))
  }

  const service = new AppService({
    userDataPath,
    openPath: async () => undefined,
  })
  await service.init()
  service.updateSettings({
    cleanupRetentionDays: 30,
    scanRoots: Object.fromEntries(sources.map((source) => [source, [path.join(fixtureRoot, source)]])),
    exportDirectory: path.join(userDataPath, 'Exports'),
  })

  const snapshot = await service.rescan()
  assert.equal(snapshot.overview.totalSessions, sources.length, 'all source sessions should be scanned')
  assert.equal(snapshot.cleanup.length, sources.length, 'old sessions should become cleanup candidates')
  assert.ok(snapshot.overview.totalTokens > 0, 'token totals should be indexed')

  const session = snapshot.sessions.find((item) => item.source === 'codex')
  assert.ok(session, 'codex session should exist')
  assert.equal(session.projectName, 'codex', 'project name should be derived from cwd')
  assert.equal(session.branch, 'main', 'branch should be extracted')
  assert.equal(session.tokens.cacheCreation, 3000, 'cache creation tokens should be counted')
  assert.equal(session.tokens.cacheRead, 30, 'cache read tokens should be counted')
  assert.equal(session.tokens.total, 3340, 'token total should include cache creation, cache read, and Codex cached input tokens')
  assert.equal(session.tokens.costUsd, 0.75, 'Claude/Codex style costUSD should be accumulated')
  assert.equal('sample' in session.metadata, false, 'raw JSON samples should not be stored in SQLite')
  const today = new Date().toISOString().slice(0, 10)
  const fixtureUsageDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  assert.equal(
    snapshot.usage.find((point) => point.date === fixtureUsageDate)?.total,
    sources.length * 3340,
    'usage chart should bucket tokens by message timestamp beyond the last 30 days',
  )
  assert.equal(snapshot.usage.length, 365, 'usage chart should keep one year of daily buckets')
  assert.ok(
    snapshot.usage.some((point) => point.date === fixtureUsageDate && point.total > 0),
    'usage chart should include active days within the one-year range',
  )

  const backup = await service.backupSession(session.id)
  assert.ok((await stat(backup.backupPath)).size > 0, 'backup file should be written')

  const markdownPath = await service.exportSession(session.id, 'markdown')
  assert.match(await readFile(markdownPath, 'utf8'), /# Refactor codex auth flow/)

  const jsonPath = await service.exportSession(session.id, 'json')
  const exportedSession = JSON.parse(await readFile(jsonPath, 'utf8')) as { id: string }
  assert.equal(exportedSession.id, session.id, 'JSON export should contain the session')

  const relayPath = await service.exportUniversalRelay(session.id)
  const relay = JSON.parse(await readFile(relayPath, 'utf8')) as { schema: string; messages: unknown[] }
  assert.equal(relay.schema, 'clean-my-agent.universal-session.v1')
  assert.ok(relay.messages.length >= 2, 'relay JSON should include messages')

  const cleanup = await service.scanCleanup()
  const target = cleanup.find((item) => item.sessionIds.includes(session.id))
  assert.ok(target, 'cleanup candidate should reference the session')

  const trash = await service.moveCleanupToTrash([target.id])
  assert.equal(trash.length, 1, 'cleanup should move one item to trash')
  assert.equal((await service.getSnapshot(false)).sessions.some((item) => item.id === session.id), false)

  await service.restoreTrash(trash[0].id)
  assert.equal((await service.getSnapshot(true)).sessions.some((item) => item.id === session.id), true)

  const staleService = new AppService({
    userDataPath: await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-stale-user-data-')),
    openPath: async () => undefined,
  })
  await staleService.init()
  staleService.updateSettings({
    cleanupRetentionDays: 30,
    scanRoots: Object.fromEntries(sources.map((source) => [source, source === 'codex' ? [path.join(fixtureRoot, source)] : [path.join(fixtureRoot, 'missing', source)]])),
    exportDirectory: path.join(userDataPath, 'StaleExports'),
  })
  await staleService.rescan()
  const staleSnapshot = await staleService.getSnapshot(false)
  staleSnapshot.sessions[0].tokens.total = 1
  staleSnapshot.sessions[0].metadata.usageByDate = { [today]: 1 }
  // Simulate an app upgrade where cached session rows were produced by an older parser.
  ;(staleService as unknown as { db: { replaceSessions: (sessions: unknown[]) => void; setSetting: (key: string, value: unknown) => void } }).db.replaceSessions(staleSnapshot.sessions)
  ;(staleService as unknown as { db: { setSetting: (key: string, value: unknown) => void } }).db.setSetting('scanSchemaVersion', 1)
  const refreshedSnapshot = await staleService.getSnapshot(false)
  assert.equal(refreshedSnapshot.overview.totalTokens, 3340, 'stale scan cache should be invalidated automatically')

  console.log('Function verification passed')
}

await main()
