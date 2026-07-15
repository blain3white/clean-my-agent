import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { AppService } from '../electron/lib/app-service'
import type { AgentSource } from '../src/shared/types'

const sources: AgentSource[] = ['codex', 'claude', 'cursor', 'gemini', 'opencode', 'pi', 'custom']
const piUsageTotal = 1160
const fakeTrashItem = (targetPath: string) => rm(targetPath, { recursive: true, force: true })

function slashPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

async function writeSession(root: string, source: AgentSource, daysOld: number, name = 'session') {
  const dir = path.join(root, source)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${source}-${name}.jsonl`)
  const workspace = path.join(os.tmpdir(), 'clean-my-agent-fixture', source)
  const date = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)
  const timestamp = date.toISOString()
  if (source === 'pi') {
    return writePiSession(filePath, workspace, timestamp, date)
  }
  const referencedFile = path.join(workspace, 'src', 'auth.ts')
  const sensitiveFile = path.join(workspace, '.env.local')
  const attachmentPath = path.join(workspace, 'artifacts', 'auth-flow.png')
  const gitDiff = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -1 +1 @@',
    '-old auth flow',
    '+new auth flow',
  ].join('\n')
  const lines = [
    {
      role: 'user',
      timestamp,
      content: `Refactor ${source} auth flow`,
      cwd: workspace,
      branch: 'main',
      command: `TOKEN=secret pnpm test --filter ${source} --api-key sk-test`,
      files: [{ path: referencedFile }, { path: sensitiveFile }],
      attachments: [{ path: attachmentPath, mediaType: 'image/png', sizeBytes: 2048 }],
      gitDiff,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 10,
      },
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
        model: 'gpt-5-codex',
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

// Writes a Pi-agent shaped JSONL session: a `session` header carrying the
// project cwd, a user message, and an assistant message whose nested
// `message.usage` uses Pi's bare field names (input/output/cacheRead/cacheWrite/
// totalTokens). This exercises both Pi format parsing and the generic usage
// extractor's bare-name aliases.
async function writePiSession(filePath: string, workspace: string, timestamp: string, date: Date) {
  const lines = [
    { type: 'session', version: 3, id: 'pi-session-1', timestamp, cwd: workspace },
    {
      type: 'message',
      id: 'pi-user-1',
      parentId: null,
      timestamp,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Refactor pi auth flow' }],
        timestamp,
      },
    },
    {
      type: 'message',
      id: 'pi-assistant-1',
      parentId: 'pi-user-1',
      timestamp,
      message: {
        role: 'assistant',
        model: 'glm-5.2',
        content: [{ type: 'text', text: 'Finished pi refactor' }],
        usage: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 1000,
          totalTokens: piUsageTotal,
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
    trashItem: fakeTrashItem,
  })
  await service.init()
  service.updateSettings({
    cleanupRetentionDays: 30,
    usageTimezone: 'UTC',
    scanRoots: Object.fromEntries(
      sources.map((source) => [source, [path.join(fixtureRoot, source)]]),
    ),
    exportDirectory: path.join(userDataPath, 'Exports'),
    worktreeScanDefaultRoots: false,
  })

  const snapshot = await service.rescan()
  assert.equal(
    snapshot.overview.totalSessions,
    sources.length,
    'all source sessions should be scanned',
  )
  assert.equal(
    snapshot.cleanup.length,
    sources.length,
    'old sessions should become cleanup candidates',
  )
  assert.ok(snapshot.overview.totalTokens > 0, 'token totals should be indexed')

  const session = snapshot.sessions.find((item) => item.source === 'codex')
  assert.ok(session, 'codex session should exist')
  assert.equal(session.projectName, 'codex', 'project name should be derived from cwd')
  assert.equal(session.branch, 'main', 'branch should be extracted')
  assert.equal(session.tokens.cacheCreation, 3000, 'cache creation tokens should be counted')
  assert.equal(session.tokens.cacheRead, 30, 'cache read tokens should be counted')
  assert.equal(
    session.tokens.input,
    150,
    'Codex cached input should be separated from non-cached input',
  )
  assert.equal(
    session.tokens.total,
    3340,
    'token total should include cache creation, cache read, and Codex cached input tokens',
  )
  assert.equal(
    session.tokens.costUsd?.toFixed(6),
    '0.750328',
    'missing costUSD should fall back to model pricing when a priced model is known',
  )
  assert.equal(
    session.tokens.costSource,
    'mixed',
    'cost source should distinguish actual and priced cost',
  )
  assert.equal(
    'sample' in session.metadata,
    false,
    'raw JSON samples should not be stored in SQLite',
  )
  assert.ok(
    Array.isArray(session.metadata.relayFiles) &&
      session.metadata.relayFiles.some((item) => {
        return (
          typeof item === 'object' &&
          item !== null &&
          'path' in item &&
          slashPath(String(item.path)).endsWith('/codex/src/auth.ts')
        )
      }),
    'scan metadata should retain relay file references for reports',
  )
  assert.ok(
    Array.isArray(session.metadata.relayFiles) &&
      session.metadata.relayFiles.every((item) => {
        return (
          typeof item !== 'object' ||
          item === null ||
          !('path' in item) ||
          !String(item.path).includes('.env')
        )
      }),
    'scan metadata should not cache credential-like file paths for reports',
  )
  assert.ok(
    Array.isArray(session.metadata.relayCommands) &&
      session.metadata.relayCommands.some((item) => {
        return (
          typeof item === 'object' &&
          item !== null &&
          'command' in item &&
          item.command === 'TOKEN=[redacted] pnpm test --filter codex --api-key [redacted]'
        )
      }),
    'scan metadata should retain redacted relay commands for reports',
  )
  assert.deepEqual(
    session.metadata.gitChangedFiles,
    ['src/auth.ts'],
    'scan metadata should retain changed file paths without storing diff content',
  )
  const today = new Date().toISOString().slice(0, 10)
  const fixtureUsageDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  assert.equal(
    snapshot.usage.find((point) => point.date === fixtureUsageDate)?.total,
    (sources.length - 1) * 3340 + piUsageTotal,
    'usage chart should bucket tokens by message timestamp beyond the last 30 days',
  )
  assert.equal(snapshot.usage.length, 365, 'usage chart should keep one year of daily buckets')
  assert.ok(
    snapshot.usage.some((point) => point.date === fixtureUsageDate && point.total > 0),
    'usage chart should include active days within the one-year range',
  )

  const backup = await service.backupSession(session.id)
  assert.ok((await stat(backup.backupPath)).size > 0, 'backup file should be written')

  const recentFile = await writeSession(fixtureRoot, 'codex', 0, 'recent')
  const recentSnapshot = await service.refreshRecentSessions(10)
  assert.ok(
    recentSnapshot.sessions.some(
      (item) =>
        item.source === 'codex' &&
        item.storagePath === recentFile &&
        item.lastUpdated.slice(0, 10) === today,
    ),
    'recent refresh should update the latest session without a full rescan',
  )

  const markdownPath = await service.exportSession(session.id, 'markdown')
  assert.match(await readFile(markdownPath, 'utf8'), /# Refactor codex auth flow/)

  const jsonPath = await service.exportSession(session.id, 'json')
  const exportedSession = JSON.parse(await readFile(jsonPath, 'utf8')) as { id: string }
  assert.equal(exportedSession.id, session.id, 'JSON export should contain the session')

  const relayPath = await service.exportUniversalRelay(session.id)
  const relay = JSON.parse(await readFile(relayPath, 'utf8')) as {
    schema: string
    messages: unknown[]
    files: Array<{ path: string }>
    commands: Array<{ command: string }>
    attachments: Array<{ path: string; mediaType?: string; sizeBytes?: number }>
    git?: { diff?: string }
  }
  assert.equal(relay.schema, 'clean-my-agent.universal-session.v1')
  assert.ok(relay.messages.length >= 2, 'relay JSON should include messages')
  assert.ok(
    relay.commands.some((item) => item.command.includes('pnpm test --filter codex')),
    'relay JSON should include extracted commands',
  )
  assert.ok(
    relay.files.some((item) => slashPath(item.path).endsWith('/codex/src/auth.ts')),
    'relay JSON should include extracted file references',
  )
  assert.ok(
    relay.attachments.some(
      (item) =>
        slashPath(item.path).endsWith('/codex/artifacts/auth-flow.png') &&
        item.mediaType === 'image/png' &&
        item.sizeBytes === 2048,
    ),
    'relay JSON should include extracted attachments',
  )
  assert.match(relay.git?.diff ?? '', /diff --git a\/src\/auth\.ts b\/src\/auth\.ts/)

  const cleanup = await service.scanCleanup()
  const target = cleanup.find((item) => item.sessionIds.includes(session.id))
  assert.ok(target, 'cleanup candidate should reference the session')

  const tokensBeforeTrash = (await service.getSnapshot(false)).overview.totalTokens
  const trash = await service.moveCleanupToTrash([target.id])
  assert.equal(trash.length, 1, 'cleanup should move one item to the system Trash')
  await assert.rejects(
    stat(session.storagePath),
    undefined,
    'trashed session path should be removed',
  )
  const snapshotWithDeletedStats = await service.getSnapshot(false)
  assert.ok(
    !snapshotWithDeletedStats.sessions.some((item) => item.id === session.id),
    'trashed session should disappear from active sessions',
  )
  assert.equal(
    snapshotWithDeletedStats.overview.totalTokens,
    tokensBeforeTrash,
    'token totals should include deleted sessions by default',
  )
  service.updateSettings({ includeDeletedSessionsInStats: false })
  assert.equal(
    (await service.getSnapshot(false)).overview.totalTokens,
    tokensBeforeTrash - session.tokens.total,
    'token totals should exclude deleted sessions when the setting is disabled',
  )

  const staleService = new AppService({
    userDataPath: await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-stale-user-data-')),
    openPath: async () => undefined,
    trashItem: fakeTrashItem,
  })
  await staleService.init()
  staleService.updateSettings({
    cleanupRetentionDays: 30,
    scanRoots: Object.fromEntries(
      sources.map((source) => [
        source,
        source === 'codex'
          ? [path.join(fixtureRoot, source)]
          : [path.join(fixtureRoot, 'missing', source)],
      ]),
    ),
    exportDirectory: path.join(userDataPath, 'StaleExports'),
  })
  await staleService.rescan()
  const staleSnapshot = await staleService.getSnapshot(false)
  const expectedStaleTokenTotal = staleSnapshot.overview.totalTokens
  staleSnapshot.sessions[0].tokens.total = 1
  staleSnapshot.sessions[0].metadata.usageByDate = { [today]: 1 }
  // Simulate an app upgrade where cached session rows were produced by an older parser.
  ;(
    staleService as unknown as {
      db: {
        replaceSessions: (sessions: unknown[]) => void
        setSetting: (key: string, value: unknown) => void
      }
    }
  ).db.replaceSessions(staleSnapshot.sessions)
  ;(
    staleService as unknown as { db: { setSetting: (key: string, value: unknown) => void } }
  ).db.setSetting('scanSchemaVersion', 1)
  const cachedStaleSnapshot = await staleService.getSnapshot(false)
  assert.notEqual(
    cachedStaleSnapshot.overview.totalTokens,
    expectedStaleTokenTotal,
    'cached snapshot should return immediately without an implicit scan',
  )
  const refreshedSnapshot = await staleService.rescan()
  assert.equal(
    refreshedSnapshot.overview.totalTokens,
    expectedStaleTokenTotal,
    'explicit background rescan should replace stale cached parser output',
  )

  // ---------------------------------------------------------------------
  // Worktree cleanup: scan → suggest → system Trash → prune
  // ---------------------------------------------------------------------
  const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0
  assert.ok(gitAvailable, 'git must be available for the worktree smoke test')

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'cma-worktree-root-'))
  const parentRepo = await mkdtemp(path.join(os.tmpdir(), 'cma-worktree-parent-'))
  const runGit = (args: string[], cwd: string) => spawnSync('git', args, { cwd, encoding: 'utf8' })
  // Initialise a parent repo with one commit.
  assert.equal(runGit(['init', '-q'], parentRepo).status, 0, 'git init should succeed')
  await writeFile(path.join(parentRepo, 'README.md'), 'hello\n')
  assert.equal(runGit(['add', 'README.md'], parentRepo).status, 0)
  assert.equal(
    runGit(
      ['-c', 'user.email=smoke@test', '-c', 'user.name=Smoke', 'commit', '-q', '-m', 'init'],
      parentRepo,
    ).status,
    0,
    'git commit should succeed',
  )
  // Add a linked worktree under the worktree root.
  const worktreeDir = path.join(worktreeRoot, 'feature-smoke')
  assert.equal(
    runGit(['worktree', 'add', worktreeDir, '-b', 'feature-smoke'], parentRepo).status,
    0,
    'git worktree add should succeed',
  )
  // Make the worktree stale by setting its mtime far in the past.
  const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  await utimes(worktreeDir, staleDate, staleDate)
  // A second, active worktree (fresh mtime) to exercise "list all".
  const activeDir = path.join(worktreeRoot, 'active-smoke')
  assert.equal(
    runGit(['worktree', 'add', activeDir, '-b', 'active-smoke'], parentRepo).status,
    0,
    'git worktree add (active) should succeed',
  )

  const worktreeService = new AppService({
    userDataPath: await mkdtemp(path.join(os.tmpdir(), 'cma-worktree-userdata-')),
    openPath: async () => undefined,
    trashItem: fakeTrashItem,
  })
  await worktreeService.init()
  worktreeService.updateSettings({
    cleanupRetentionDays: 0,
    worktreeRoots: [worktreeRoot],
    worktreeScanDefaultRoots: false,
    scanRoots: {},
    exportDirectory: path.join(os.tmpdir(), 'cma-worktree-exports'),
  })

  const wtCleanup = await worktreeService.scanCleanup()
  const wtCandidate = wtCleanup.find((item) => item.kind === 'stale-worktree')
  assert.ok(wtCandidate, 'abandoned worktree should appear as a stale-worktree candidate')
  assert.equal(wtCandidate.risk, 'low', 'clean stale worktree should be low-risk')
  assert.equal(wtCandidate.backedUp, true, 'clean worktree is regenerable from git')
  // Cleanup lists ALL worktrees, not just stale ones.
  assert.ok(
    wtCleanup.some((item) => item.kind === 'active-worktree'),
    'cleanup should also list the active worktree',
  )

  // Snapshot carries first-class worktree records for both worktrees.
  const wtSnapshot = await worktreeService.getSnapshot(false)
  assert.ok(
    wtSnapshot.worktrees.length >= 2,
    'snapshot should include a WorktreeRecord per worktree',
  )
  const staleRecord = wtSnapshot.worktrees.find((w) => w.path === worktreeDir)
  const activeRecord = wtSnapshot.worktrees.find((w) => w.path === activeDir)
  assert.ok(staleRecord && staleRecord.stale, 'stale worktree record should be marked stale')
  assert.ok(activeRecord && !activeRecord.stale, 'active worktree record should not be stale')
  // Overview total size includes worktree sizes (at least the two worktrees).
  const worktreeBytes = wtSnapshot.worktrees.reduce((sum, w) => sum + w.sizeBytes, 0)
  assert.ok(
    wtSnapshot.overview.totalSizeBytes >= worktreeBytes,
    'overview total should include worktree sizes',
  )
  // No double-count: storage slices' sum should not exceed sessions + archives + worktrees by
  // more than the worktree bytes once.
  const storageTotal = wtSnapshot.storage.reduce((sum, s) => sum + s.sizeBytes, 0)
  assert.ok(storageTotal >= worktreeBytes, 'storage should reflect worktree sizes')

  const [wtTrash] = await worktreeService.moveCleanupToTrash([wtCandidate.id])
  assert.ok(wtTrash, 'worktree candidate should move to the system Trash')
  assert.equal(wtTrash.kind, 'stale-worktree', 'trash result should carry the worktree kind')
  await assert.rejects(stat(worktreeDir), undefined, 'worktree directory should be removed')

  // Prune should have cleared the parent repo's stale worktree registration.
  const worktreeList = runGit(['worktree', 'list'], parentRepo).stdout
  assert.ok(
    !worktreeList.includes('feature-smoke'),
    'parent repo should no longer list the trashed worktree after prune',
  )

  console.log('Function verification passed')
}

await main()
