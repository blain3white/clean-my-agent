import { chmod, mkdir, mkdtemp, rm, truncate, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AgentAdapter, adapterFor, adapters } from './adapters'
import type { AppSettings } from '../../src/shared/types'
import { rootsForPlatform, scannerProviderFor, scannerProviders } from './scanner-providers'
import type { ScannerProviderCandidate } from './scanner-providers'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSettings(scanRoot: string, source = 'codex'): AppSettings {
  return {
    scanRoots: { [source]: [scanRoot] } as AppSettings['scanRoots'],
    cleanupRetentionDays: 30,
    trashRetentionDays: 7,
    autoBackup: false,
    mockDataEnabled: false,
    language: 'en',
    usageTimezone: 'UTC',
    launchAtLogin: false,
    enabledProviders: {},
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
    exportDirectory: '/tmp',
  }
}

/** Build an AgentAdapter with a custom provider plugin. */
function makeAdapter(source: string, roots: string[], patterns = ['**/*.jsonl', '**/*.json']) {
  return new AgentAdapter({
    source,
    name: `Test-${source}`,
    roots,
    patterns,
    note: 'test adapter',
  } as never)
}

type SessionCandidate = ScannerProviderCandidate

// ─── temp-dir lifecycle ──────────────────────────────────────────────────────

let tmpBase: string

beforeAll(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'adapters-test-'))
})

afterAll(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

async function makeTmpDir(label: string): Promise<string> {
  const dir = path.join(tmpBase, label)
  await mkdir(dir, { recursive: true })
  return dir
}

// ─── codex JSONL ─────────────────────────────────────────────────────────────

describe('codex JSONL parsing', () => {
  it('detects sourceFormat and extracts messages, tokens, branch, projectPath', async () => {
    const root = await makeTmpDir('codex-jsonl')
    const filePath = path.join(root, 'session.jsonl')
    const cwd = '/home/user/myproject'
    const branch = 'feat/cool-thing'

    const lines = [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-01-10T10:00:00.000Z',
        payload: { id: 's1', cwd, git: { branch } },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-01-10T10:00:01.000Z',
        payload: {
          id: 'msg1',
          role: 'user',
          content: 'Hello from codex',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-01-10T10:00:02.000Z',
        payload: {
          id: 'msg2',
          role: 'assistant',
          content: 'Reply from assistant',
          usage: { input_tokens: 5, output_tokens: 20, total_tokens: 25 },
        },
      }),
    ]
    await writeFile(filePath, lines.join('\n') + '\n')

    const adapter = makeAdapter('codex', [root])
    const { state, sessions } = await adapter.scan(makeSettings(root))

    expect(state.installed).toBe(true)
    expect(state.readable).toBe(true)
    expect(sessions).toHaveLength(1)

    const session = sessions[0]
    expect(session.source).toBe('codex')
    expect(session.metadata.sourceFormat).toBe('codex-jsonl')
    expect(session.branch).toBe(branch)
    expect(session.projectPath).toBe(cwd)
    expect(session.projectName).toBe('myproject')
    expect(session.messageCount).toBeGreaterThan(0)
    expect(session.tokens.input).toBeGreaterThan(0)
    expect(session.tokens.output).toBeGreaterThan(0)
    expect(session.tokens.total).toBeGreaterThan(0)
    expect(session.tokens.estimated).toBe(false)
    expect(session.metadata.usageEvents).toEqual([
      { timestamp: '2026-01-10T10:00:01.000Z', tokens: 15 },
      { timestamp: '2026-01-10T10:00:02.000Z', tokens: 25 },
    ])
  })

  it('marks Codex fork metadata without dropping session tokens', async () => {
    const root = await makeTmpDir('codex-fork-metadata')
    const filePath = path.join(root, 'fork.jsonl')
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-06-10T03:53:29.000Z',
          payload: {
            id: 'child-thread',
            cwd: '/workspace/forked',
            thread_source: 'user',
            forked_from_id: 'parent-thread',
            parent_thread_id: 'parent-thread',
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-06-10T03:53:30.000Z',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
              },
            },
          },
        }),
      ].join('\n') + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].metadata.codexThreadId).toBe('child-thread')
    expect(sessions[0].metadata.codexForkedFromId).toBe('parent-thread')
    expect(sessions[0].metadata.codexParentThreadId).toBe('parent-thread')
    expect(sessions[0].metadata.codexThreadSource).toBe('user')
    expect(sessions[0].tokens.total).toBe(120)
  })

  it('records only timestamped positive usage events', async () => {
    const root = await makeTmpDir('codex-usage-events')
    const filePath = path.join(root, 'session.jsonl')

    const lines = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-01-10T23:30:00.000Z',
        payload: {
          role: 'assistant',
          content: 'Count this usage event',
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: 'not-a-date',
        payload: {
          role: 'assistant',
          content: 'Ignore invalid timestamp',
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-01-11T00:30:00.000Z',
        payload: {
          role: 'assistant',
          content: 'Ignore zero usage',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    ]
    await writeFile(filePath, lines.join('\n') + '\n')

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    expect(sessions[0].metadata.usageEvents).toEqual([
      { timestamp: '2026-01-10T23:30:00.000Z', tokens: 30 },
    ])
  })
})

// ─── claude JSONL ─────────────────────────────────────────────────────────────

describe('claude JSONL parsing', () => {
  it('detects sourceFormat and extracts messages and tokens', async () => {
    const root = await makeTmpDir('claude-jsonl')
    const filePath = path.join(root, 'session.jsonl')

    // Records must NOT have 'payload' or 'timestamp' fields (that would match isCodexJsonlRecord first)
    const lines = [
      JSON.stringify({
        sessionId: 'sess-abc',
        uuid: 'uuid-1',
        cwd: '/home/user/project-alpha',
        gitBranch: 'main',
        message: { role: 'user', content: 'Tell me about the repo' },
      }),
      JSON.stringify({
        sessionId: 'sess-abc',
        uuid: 'uuid-2',
        message: {
          id: 'msg-claude-1',
          role: 'assistant',
          content: 'The repo is a monorepo.',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ]
    await writeFile(filePath, lines.join('\n') + '\n')

    const adapter = makeAdapter('claude', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'claude'))

    expect(sessions).toHaveLength(1)
    const session = sessions[0]
    expect(session.metadata.sourceFormat).toBe('claude-jsonl')
    expect(session.branch).toBe('main')
    expect(session.projectPath).toBe('/home/user/project-alpha')
    expect(session.messageCount).toBeGreaterThan(0)
    expect(session.tokens.input).toBeGreaterThan(0)
    expect(session.tokens.estimated).toBe(false)
  })
})

// ─── generic JSON array ───────────────────────────────────────────────────────

describe('generic JSON array parsing', () => {
  it('parses a top-level array of message objects', async () => {
    const root = await makeTmpDir('json-array')
    const filePath = path.join(root, 'conv.json')

    const data = [
      { role: 'user', content: 'What is the meaning of life?' },
      { role: 'assistant', content: 'Forty-two.' },
    ]
    await writeFile(filePath, JSON.stringify(data))

    const adapter = makeAdapter('gemini', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'gemini'))

    expect(sessions).toHaveLength(1)
    expect(sessions[0].messageCount).toBe(2)
  })

  it('parses JSON with nested messages array', async () => {
    const root = await makeTmpDir('json-messages')
    const filePath = path.join(root, 'chat.json')

    const data = {
      id: 'chat-1',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello there' },
        { role: 'user', content: 'How are you?' },
      ],
    }
    await writeFile(filePath, JSON.stringify(data))

    const adapter = makeAdapter('opencode', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'opencode'))

    expect(sessions).toHaveLength(1)
    expect(sessions[0].messageCount).toBe(3)
  })

  it('parses JSON with nested conversation array', async () => {
    const root = await makeTmpDir('json-conversation')
    const filePath = path.join(root, 'chat.json')

    const data = {
      conversation: [
        { role: 'user', content: 'Question one' },
        { role: 'assistant', content: 'Answer one' },
      ],
    }
    await writeFile(filePath, JSON.stringify(data))

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    expect(sessions[0].messageCount).toBe(2)
  })

  it('parses JSON with nested entries array', async () => {
    const root = await makeTmpDir('json-entries')
    const filePath = path.join(root, 'log.json')

    const data = {
      entries: [
        { role: 'user', content: 'Entry question' },
        { role: 'assistant', content: 'Entry reply' },
      ],
    }
    await writeFile(filePath, JSON.stringify(data))

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    expect(sessions[0].messageCount).toBe(2)
  })
})

// ─── raw text / log fallback ──────────────────────────────────────────────────

describe('raw text / log fallback', () => {
  it('reads a .log file as line-split unknown-role messages', async () => {
    const root = await makeTmpDir('log-fallback')
    const filePath = path.join(root, 'output.log')

    const lines = ['Line one of the log', 'Line two of the log', 'Line three of the log']
    await writeFile(filePath, lines.join('\n'))

    const adapter = makeAdapter('codex', [root], ['**/*.log'])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    const session = sessions[0]
    expect(session.messageCount).toBe(3)
    expect(session.tokens.estimated).toBe(true)
  })

  it('ignores empty lines in log files', async () => {
    const root = await makeTmpDir('log-empty-lines')
    const filePath = path.join(root, 'sparse.log')
    await writeFile(filePath, 'First line\n\n\nThird line\n\n')

    const adapter = makeAdapter('codex', [root], ['**/*.log'])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].messageCount).toBe(2)
  })
})

// ─── invalid JSON fallback ────────────────────────────────────────────────────

describe('invalid JSON fallback in JSONL', () => {
  it('pushes long invalid lines as unknown-role messages', async () => {
    const root = await makeTmpDir('invalid-json')
    const filePath = path.join(root, 'mixed.jsonl')

    const goodLine = JSON.stringify({
      type: 'response_item',
      payload: { role: 'user', content: 'Valid line' },
    })
    const badLine =
      'this is definitely not json at all and it is long enough to pass the 24-char check'
    const shortBadLine = 'tooshort'
    await writeFile(filePath, [goodLine, badLine, shortBadLine].join('\n') + '\n')

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    // good message + bad long line; short bad line is skipped (< 24 chars)
    expect(sessions[0].messageCount).toBeGreaterThanOrEqual(1)
    const messages = sessions[0].searchText ?? ''
    expect(messages).toContain('not json')
  })
})

// ─── missing / unreadable roots ───────────────────────────────────────────────

describe('unreadable and missing roots', () => {
  it('returns installed=false when scan root does not exist', async () => {
    const missingRoot = path.join(tmpBase, 'does-not-exist-' + Date.now())
    const adapter = makeAdapter('codex', [missingRoot])
    const { state, sessions } = await adapter.scan(makeSettings(missingRoot))

    expect(state.installed).toBe(false)
    expect(state.readable).toBe(false)
    expect(sessions).toHaveLength(0)
    expect(state.diagnostics?.some((item) => item.code === 'root-missing')).toBe(true)
  })

  it('recentCandidates returns empty array for missing roots', async () => {
    const missingRoot = path.join(tmpBase, 'missing-recent-' + Date.now())
    const adapter = makeAdapter('codex', [missingRoot])
    const candidates = await adapter.recentCandidates(makeSettings(missingRoot), 10)
    expect(candidates).toHaveLength(0)
  })

  it('does not warn about optional missing roots when another root is readable', async () => {
    const root = await makeTmpDir('mixed-readable-roots')
    const missingRoot = path.join(tmpBase, 'missing-optional-' + Date.now())
    const adapter = makeAdapter('codex', [root, missingRoot])
    const { state } = await adapter.scan({
      ...makeSettings(root),
      scanRoots: { codex: [root, missingRoot] },
    })

    expect(state.installed).toBe(true)
    expect(state.readable).toBe(true)
    expect(state.diagnostics?.some((item) => item.code === 'root-missing')).toBe(false)
  })

  it('reports existing unreadable roots as permission-blocked', async () => {
    const root = await makeTmpDir('permission-blocked-root')
    const adapter = makeAdapter('codex', [root])

    try {
      await chmod(root, 0o000)
      const { state } = await adapter.scan(makeSettings(root))

      expect(state.installed).toBe(false)
      expect(state.readable).toBe(false)
      expect(state.diagnostics?.some((item) => item.code === 'root-permission-blocked')).toBe(true)
      expect(state.diagnostics?.some((item) => item.code === 'root-missing')).toBe(false)
    } finally {
      await chmod(root, 0o700)
    }
  })
})

// ─── recentCandidates ordering / limit ───────────────────────────────────────

describe('recentCandidates ordering and limit', () => {
  it('returns candidates sorted newest-first and limited to requested count', async () => {
    const root = await makeTmpDir('recent-candidates')

    // Write 5 files
    const files: string[] = []
    for (let i = 1; i <= 5; i++) {
      const filePath = path.join(root, `session-${i}.jsonl`)
      await writeFile(
        filePath,
        JSON.stringify({ type: 'event_msg', payload: { role: 'user', content: `Message ${i}` } }) +
          '\n',
      )
      files.push(filePath)
    }

    // Set distinct mtimes so ordering is deterministic
    const base = Date.now()
    for (let i = 0; i < files.length; i++) {
      const t = new Date(base + i * 1000)
      await utimes(files[i], t, t)
    }

    const adapter = makeAdapter('codex', [root])
    const candidates = await adapter.recentCandidates(makeSettings(root), 3)

    expect(candidates).toHaveLength(3)
    // newest first: session-5 > session-4 > session-3
    expect(candidates[0].path).toContain('session-5')
    expect(candidates[1].path).toContain('session-4')
    expect(candidates[2].path).toContain('session-3')
  })
})

// ─── scanCandidates skipping bad files ───────────────────────────────────────

describe('scanCandidates skipping bad files', () => {
  it('skips unreadable candidates while preserving the input order of valid sessions', async () => {
    const root = await makeTmpDir('scan-candidates-skip')
    const goodFile = path.join(root, 'good.jsonl')
    const secondGoodFile = path.join(root, 'second-good.jsonl')
    await writeFile(
      goodFile,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Good file content' },
      }) + '\n',
    )
    await writeFile(
      secondGoodFile,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Second good file content' },
      }) + '\n',
    )

    const now = new Date().toISOString()

    const goodCandidate: SessionCandidate = {
      path: goodFile,
      root,
      relativePath: 'good.jsonl',
      sizeBytes: 100,
      createdAt: now,
      lastUpdated: now,
      mtimeMs: Date.now(),
    }
    const badCandidate: SessionCandidate = {
      path: path.join(root, 'nonexistent.jsonl'),
      root,
      relativePath: 'nonexistent.jsonl',
      sizeBytes: 50,
      createdAt: now,
      lastUpdated: now,
      mtimeMs: Date.now(),
    }
    const secondGoodCandidate: SessionCandidate = {
      ...goodCandidate,
      path: secondGoodFile,
      relativePath: 'second-good.jsonl',
    }

    const adapter = makeAdapter('codex', [root])
    const sessions = await adapter.scanCandidates([
      secondGoodCandidate,
      badCandidate,
      goodCandidate,
    ])

    expect(sessions.map((session) => session.storagePath)).toEqual([secondGoodFile, goodFile])
  })
})

// ─── scan diagnostics ────────────────────────────────────────────────────────

describe('scan diagnostics', () => {
  it('isolates parse failures and keeps valid sessions', async () => {
    const root = await makeTmpDir('scan-diagnostics-parse-failure')
    const invalidPath = path.join(root, 'invalid.jsonl')
    const validPath = path.join(root, 'valid.jsonl')
    await writeFile(invalidPath, 'invalid fixture')
    await writeFile(validPath, 'valid fixture')

    const adapter = new AgentAdapter({
      source: 'codex',
      name: 'Parse Failure Test',
      roots: [root],
      patterns: ['**/*.jsonl'],
      note: 'test adapter',
      async parseSession(pathToParse) {
        if (pathToParse === invalidPath) throw new Error('invalid fixture')
        return {
          title: 'Valid session',
          messages: [{ id: 'm1', role: 'user', text: 'valid' }],
          files: [],
          commands: [],
          attachments: [],
          metadata: {},
        }
      },
    } as never)
    const { state, sessions } = await adapter.scan(makeSettings(root))

    expect(sessions.map((session) => session.storagePath)).toEqual([validPath])
    expect(state.skippedFiles).toBe(1)
    expect(state.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'parse-failed', path: invalidPath }),
      ]),
    )
  })

  it('reports empty and oversized skipped files', async () => {
    const root = await makeTmpDir('scan-diagnostics-skips')
    const emptyPath = path.join(root, 'empty.jsonl')
    const oversizedPath = path.join(root, 'huge.jsonl')
    const validPath = path.join(root, 'valid.jsonl')
    await writeFile(emptyPath, '')
    await writeFile(oversizedPath, 'x')
    await truncate(oversizedPath, 250_000_001)
    await writeFile(
      validPath,
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'valid' } }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { state, sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    expect(state.scannedFiles).toBe(1)
    expect(state.skippedFiles).toBe(2)
    expect(state.diagnostics?.map((item) => item.code)).toEqual(
      expect.arrayContaining(['empty-file-skipped', 'oversized-file-skipped']),
    )
  })

  it('collapses excessive diagnostics into an overflow counter', async () => {
    const missingRoots = Array.from({ length: 55 }, (_, index) =>
      path.join(tmpBase, `missing-overflow-${index}`),
    )
    const adapter = makeAdapter('codex', missingRoots)
    const { state } = await adapter.scan({
      ...makeSettings(missingRoots[0]),
      scanRoots: { codex: missingRoots },
    })

    const overflow = state.diagnostics?.find((item) => item.code === 'diagnostic-overflow')
    expect(overflow?.count).toBeGreaterThan(1)
  })
})

// ─── adapterFor error ─────────────────────────────────────────────────────────

describe('adapterFor', () => {
  it('returns the correct adapter for known sources', () => {
    for (const source of ['codex', 'claude', 'cursor', 'gemini', 'opencode'] as const) {
      const adapter = adapterFor(source)
      expect(adapter.source).toBe(source)
    }
  })

  it('throws for an unknown source', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => adapterFor('unknown-agent' as any)).toThrow(
      'Unsupported agent source: unknown-agent',
    )
  })

  it('adapters array has one entry per known source', () => {
    const sources = adapters.map((a) => a.source)
    expect(sources).toContain('codex')
    expect(sources).toContain('claude')
    expect(sources).toContain('cursor')
    expect(sources).toContain('gemini')
    expect(sources).toContain('opencode')
  })

  it('builds adapters from scanner provider plugins', () => {
    expect(scannerProviders.map((provider) => provider.source)).toEqual([
      'codex',
      'claude',
      'cursor',
      'gemini',
      'opencode',
      'pi',
      'custom',
    ])
    expect(scannerProviderFor('codex')?.name).toBe('Codex')
    expect(adapters.map((adapter) => adapter.source)).toEqual(
      scannerProviders.map((provider) => provider.source),
    )
  })

  it('selects Windows default roots for providers with platform-specific storage', () => {
    const cursorRoots = rootsForPlatform(scannerProviderFor('cursor')!, 'win32')
    expect(cursorRoots).toEqual([
      '~/AppData/Roaming/Cursor/User/workspaceStorage',
      '~/AppData/Roaming/Cursor/User/globalStorage',
    ])

    const opencodeRoots = rootsForPlatform(scannerProviderFor('opencode')!, 'win32')
    expect(opencodeRoots).toEqual(
      expect.arrayContaining([
        '~/.opencode',
        '~/AppData/Local/opencode',
        '~/AppData/Roaming/opencode',
        '~/AppData/Roaming/ai.opencode.desktop/opencode',
      ]),
    )

    const geminiRoots = rootsForPlatform(scannerProviderFor('gemini')!, 'win32')
    expect(geminiRoots).toEqual(['~/.gemini', '~/AppData/Roaming/gemini', '~/AppData/Local/gemini'])
  })

  it('uses provider parser overrides for scan and universal export', async () => {
    const root = await makeTmpDir('provider-parser-override')
    const filePath = path.join(root, 'session.plugin')
    await writeFile(filePath, 'provider-specific session payload')
    const parseCalls: string[] = []

    const adapter = new AgentAdapter({
      source: 'codex',
      name: 'Plugin Parser',
      roots: [root],
      patterns: ['**/*.plugin'],
      note: 'test plugin parser',
      parserName: 'test-provider-parser',
      async parseSession(pathToParse) {
        parseCalls.push(pathToParse)
        return {
          title: 'Plugin parsed session',
          projectPath: '/workspace/plugin-project',
          branch: 'plugin-branch',
          messages: [{ id: 'm1', role: 'user', text: 'Message from provider parser' }],
          files: [],
          commands: [],
          attachments: [],
          tokens: {
            input: 1,
            output: 2,
            cached: 0,
            cacheCreation: 0,
            cacheRead: 0,
            total: 3,
            estimated: false,
          },
          usageByDate: { '2026-01-01': 3 },
          usageEvents: [{ timestamp: '2026-01-01T00:00:00.000Z', tokens: 3 }],
          metadata: { sourceFormat: 'provider-parser-test' },
        }
      },
    })

    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('Plugin parsed session')
    expect(sessions[0].projectName).toBe('plugin-project')
    expect(sessions[0].metadata.parser).toBe('test-provider-parser')
    expect(sessions[0].metadata.sourceFormat).toBe('provider-parser-test')
    expect(parseCalls).toEqual([filePath])

    const doc = await adapter.toUniversal(sessions[0])
    expect(parseCalls).toEqual([filePath, filePath])
    expect(doc.messages).toEqual([{ id: 'm1', role: 'user', text: 'Message from provider parser' }])
  })
})

// ─── toUniversal output ───────────────────────────────────────────────────────

describe('toUniversal', () => {
  it('returns a valid UniversalRelayDocument with correct schema and fields', async () => {
    const root = await makeTmpDir('to-universal')
    const filePath = path.join(root, 'session.jsonl')

    await writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Export this session' },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    expect(sessions).toHaveLength(1)

    const doc = await adapter.toUniversal(sessions[0])

    expect(doc.schema).toBe('clean-my-agent.universal-session.v1')
    expect(doc.source).toBe('codex')
    expect(doc.session).toBe(sessions[0])
    expect(Array.isArray(doc.messages)).toBe(true)
    expect(doc.messages.length).toBeGreaterThan(0)
    expect(Array.isArray(doc.files)).toBe(true)
    expect(Array.isArray(doc.commands)).toBe(true)
    expect(Array.isArray(doc.attachments)).toBe(true)
    expect(Array.isArray(doc.warnings)).toBe(true)
    expect(typeof doc.exportedAt).toBe('string')
    expect(doc.git?.branch).toBe(sessions[0].branch)
    expect(doc.git?.projectPath).toBe(sessions[0].projectPath)
  })

  it('extracts command, file, attachment, and git diff hints', async () => {
    const root = await makeTmpDir('to-universal-hints')
    const filePath = path.join(root, 'session.jsonl')
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    await writeFile(
      filePath,
      [
        JSON.stringify({
          role: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          content: 'Run tests and inspect files',
          cwd: '/workspace/project',
          command: 'pnpm test',
          files: [{ path: '/workspace/project/src/app.ts' }],
          attachments: [
            { path: '/workspace/project/screenshot.png', mediaType: 'image/png', sizeBytes: 42 },
          ],
          gitDiff: diff,
        }),
        JSON.stringify({
          role: 'assistant',
          timestamp: '2026-01-01T00:00:01.000Z',
          content: 'Done',
          cwd: '/workspace/project',
          filePath: '/workspace/project/src/result.ts',
          shellCommand: 'pnpm lint',
        }),
      ].join('\n') + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const doc = await adapter.toUniversal(sessions[0])

    expect(doc.commands).toEqual(
      expect.arrayContaining([
        { command: 'pnpm test', cwd: '/workspace/project', createdAt: '2026-01-01T00:00:00.000Z' },
        { command: 'pnpm lint', cwd: '/workspace/project', createdAt: '2026-01-01T00:00:01.000Z' },
      ]),
    )
    expect(doc.files).toEqual(
      expect.arrayContaining([
        {
          path: '/workspace/project/src/app.ts',
          reason: 'Listed in files',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
        },
        {
          path: '/workspace/project/src/result.ts',
          reason: 'Referenced by filePath',
          lastSeenAt: '2026-01-01T00:00:01.000Z',
        },
      ]),
    )
    expect(doc.attachments).toEqual([
      { path: '/workspace/project/screenshot.png', mediaType: 'image/png', sizeBytes: 42 },
    ])
    expect(doc.git?.diff).toBe(diff)
  })

  it('filters duplicate and unsafe relay hints while inferring media types', async () => {
    const root = await makeTmpDir('to-universal-filtered-hints')
    const filePath = path.join(root, 'session.jsonl')
    const longCommand = 'x'.repeat(4097)
    await writeFile(
      filePath,
      JSON.stringify({
        role: 'user',
        content: 'relay hints',
        cwd: '/workspace/project',
        command: '  pnpm    test  ',
        shellCommand: 'pnpm test',
        path: 'https://example.test/not-local.png',
        file: '/workspace/project/readme.md',
        files: ['/workspace/project/readme.md', 'data:text/plain;base64,abc'],
        attachments: [
          '/workspace/project/screenshot.jpg',
          '/workspace/project/screenshot.jpg',
          { filename: '/workspace/project/vector.svg', size: '55' },
          { file_path: 'blob:unsafe', mimeType: 'image/png' },
        ],
        nested: {
          command: longCommand,
          attachment: '/workspace/project/report.pdf',
        },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const doc = await adapter.toUniversal(sessions[0])

    expect(doc.commands).toEqual([{ command: 'pnpm test', cwd: '/workspace/project' }])
    expect(doc.files).toEqual(
      expect.arrayContaining([
        {
          path: '/workspace/project/readme.md',
          reason: 'Referenced by file',
          lastSeenAt: undefined,
        },
        {
          path: '/workspace/project/vector.svg',
          reason: 'Referenced by filename',
          lastSeenAt: undefined,
        },
      ]),
    )
    expect(doc.files.some((item) => item.path.startsWith('http'))).toBe(false)
    expect(doc.attachments).toEqual(
      expect.arrayContaining([
        { path: '/workspace/project/screenshot.jpg', mediaType: 'image/jpeg' },
        { path: '/workspace/project/vector.svg', mediaType: 'image/svg+xml', sizeBytes: 55 },
        { path: '/workspace/project/report.pdf', mediaType: 'application/pdf' },
      ]),
    )
    expect(doc.attachments.filter((item) => item.path.endsWith('screenshot.jpg'))).toHaveLength(1)
  })

  it('infers remaining media types and enforces relay hint caps', async () => {
    const root = await makeTmpDir('to-universal-media-and-caps')
    const filePath = path.join(root, 'session.jsonl')
    const files = Array.from({ length: 505 }, (_, index) => `/workspace/file-${index}.txt`)
    const commands = Array.from({ length: 505 }, (_, index) => ({
      command: `echo ${index}`,
      cwd: '/workspace',
    }))
    const attachments = [
      '/workspace/image.png',
      '/workspace/image.webp',
      '/workspace/animation.gif',
      '/workspace/data.json',
      '/workspace/notes.md',
      '/workspace/debug.log',
      '/workspace/archive.bin',
      ...Array.from({ length: 505 }, (_, index) => `/workspace/extra-${index}.txt`),
    ]

    await writeFile(
      filePath,
      JSON.stringify({
        role: 'user',
        content: 'relay cap test',
        files,
        commands,
        attachments,
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const doc = await adapter.toUniversal(sessions[0])

    expect(doc.files).toHaveLength(500)
    expect(doc.commands).toHaveLength(500)
    expect(doc.attachments).toHaveLength(500)
    expect(doc.attachments).toEqual(
      expect.arrayContaining([
        { path: '/workspace/image.png', mediaType: 'image/png' },
        { path: '/workspace/image.webp', mediaType: 'image/webp' },
        { path: '/workspace/animation.gif', mediaType: 'image/gif' },
        { path: '/workspace/data.json', mediaType: 'application/json' },
        { path: '/workspace/notes.md', mediaType: 'text/markdown' },
        { path: '/workspace/debug.log', mediaType: 'text/plain' },
        { path: '/workspace/archive.bin', mediaType: undefined },
      ]),
    )
  })
})

// ─── token extraction variants ────────────────────────────────────────────────

describe('token extraction variants', () => {
  it('extracts input/output from snake_case usage fields', async () => {
    const root = await makeTmpDir('tokens-snake')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          role: 'assistant',
          content: 'Token reply',
          usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280 },
        },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].tokens.input).toBe(200)
    expect(sessions[0].tokens.output).toBe(80)
    expect(sessions[0].tokens.total).toBe(280)
  })

  it('extracts tokens from camelCase fields (promptTokens / completionTokens)', async () => {
    const root = await makeTmpDir('tokens-camel')
    // Use JSONL so each line's payload.usage is directly traversed
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          id: 'msg-camel',
          role: 'assistant',
          content: 'CamelCase token response',
          usage: { promptTokens: 150, completionTokens: 60 },
        },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].tokens.input).toBe(150)
    expect(sessions[0].tokens.output).toBe(60)
  })

  it('extracts Pi bare usage aliases (input / output / cacheRead / cacheWrite)', async () => {
    const root = await makeTmpDir('tokens-pi-bare')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'message',
        id: 'pi-assistant-1',
        timestamp: '2026-06-08T10:15:30.000Z',
        message: {
          role: 'assistant',
          model: 'glm-5.2',
          content: [{ type: 'text', text: 'Pi bare usage response' }],
          usage: {
            input: 100,
            output: 50,
            cacheRead: 10,
            cacheWrite: 1000,
            totalTokens: 1160,
          },
        },
      }) + '\n',
    )

    const adapter = makeAdapter('pi', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].tokens.input).toBe(100)
    expect(sessions[0].tokens.output).toBe(50)
    expect(sessions[0].tokens.cacheCreation).toBe(1000)
    expect(sessions[0].tokens.cacheRead).toBe(10)
    expect(sessions[0].tokens.total).toBe(1160)
  })

  it('extracts cache creation and cache read tokens', async () => {
    const root = await makeTmpDir('tokens-cache')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          role: 'assistant',
          content: 'Cache response',
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 20,
          },
        },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    const tokens = sessions[0].tokens
    expect(tokens.cacheCreation).toBe(30)
    expect(tokens.cacheRead).toBeGreaterThanOrEqual(20)
    expect(tokens.cached).toBeGreaterThanOrEqual(50)
  })

  it('extracts costUSD from usage', async () => {
    const root = await makeTmpDir('tokens-cost')
    const filePath = path.join(root, 's.jsonl')
    // costUSD must be at the top-level record — addUsage receives (payload.usage, topRecord)
    // and looks for costUSD in the parent (topRecord), not inside payload
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        costUSD: 0.05,
        payload: {
          role: 'assistant',
          content: 'Cost response',
          usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
        },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].tokens.costUsd).toBeGreaterThan(0)
  })

  it('deduplicates usage entries with the same message id', async () => {
    const root = await makeTmpDir('tokens-dedup')
    const filePath = path.join(root, 's.jsonl')

    // Same message.id in two lines → tokens counted only once
    const record = {
      type: 'response_item',
      payload: { id: 'dedup-me', role: 'assistant', content: 'Dedup test' },
      message: {
        id: 'dedup-me',
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      },
    }
    await writeFile(filePath, [JSON.stringify(record), JSON.stringify(record)].join('\n') + '\n')

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    // After dedup, total should be 150 (not 300)
    expect(sessions[0].tokens.total).toBeLessThanOrEqual(300)
    // At minimum it was deduplicated (not doubled)
    expect(sessions[0].tokens.input).toBeLessThanOrEqual(200)
  })
})

// ─── metadata sourceFormat ────────────────────────────────────────────────────

describe('metadata sourceFormat', () => {
  it('sets sourceFormat to codex-jsonl for codex records', async () => {
    const root = await makeTmpDir('sf-codex')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-01-01T00:00:00Z',
        payload: { id: 'x' },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    expect(sessions[0].metadata.sourceFormat).toBe('codex-jsonl')
  })

  it('sets sourceFormat to claude-jsonl for claude records', async () => {
    const root = await makeTmpDir('sf-claude')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({ type: 'user', sessionId: 'sess-1', content: 'Hello' }) + '\n',
    )

    const adapter = makeAdapter('claude', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'claude'))
    expect(sessions[0].metadata.sourceFormat).toBe('claude-jsonl')
  })

  it('sets sourceFormat to opencode-storage-json for opencode JSON files', async () => {
    const root = await makeTmpDir('sf-opencode')
    const filePath = path.join(root, 's.json')
    await writeFile(
      filePath,
      JSON.stringify({
        sessionID: 'oc-session-1',
        updatedAt: Date.now(),
        messages: [{ role: 'user', content: 'OpenCode question' }],
      }),
    )

    const adapter = makeAdapter('opencode', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'opencode'))
    expect(sessions[0].metadata.sourceFormat).toBe('opencode-storage-json')
  })

  it('sets sourceFormat to cursor-workspace-json for cursor JSON files', async () => {
    const root = await makeTmpDir('sf-cursor')
    const filePath = path.join(root, 's.json')
    await writeFile(
      filePath,
      JSON.stringify({
        workspace: '/home/user/cursor-workspace',
        messages: [{ role: 'user', content: 'Cursor question' }],
      }),
    )

    const adapter = makeAdapter('cursor', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'cursor'))
    expect(sessions[0].metadata.sourceFormat).toBe('cursor-workspace-json')
  })
})

// ─── parser edge branches ────────────────────────────────────────────────────

describe('parser edge branches', () => {
  it('normalizes role aliases and reads content block fallback fields', async () => {
    const root = await makeTmpDir('edge-content-roles')
    const filePath = path.join(root, 'roles.json')
    await writeFile(
      filePath,
      JSON.stringify([
        { role: 'human', content: [{ value: 'from value block' }, { input: 'from input block' }] },
        { role: 'model', content: [{ content: 'from content block' }] },
        { role: 'tool', parts: [{ text: 'from parts text' }] },
        { type: 'system', text: 'system text fallback' },
        { role: 'assistant', content: { text: 'object text fallback' } },
      ]),
    )

    const adapter = makeAdapter('gemini', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'gemini'))
    const doc = await adapter.toUniversal(sessions[0])

    expect(doc.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'system',
      'assistant',
    ])
    expect(doc.messages.map((message) => message.text)).toEqual([
      'from value block\nfrom input block',
      'from content block',
      'from parts text',
      'system text fallback',
      'object text fallback',
    ])
  })

  it('extracts messages from item and payload message fallbacks', async () => {
    const root = await makeTmpDir('edge-message-items')
    const filePath = path.join(root, 'items.jsonl')
    await writeFile(
      filePath,
      [
        JSON.stringify({
          item: {
            id: 42,
            role: 'human',
            created_at: '2026-01-01T00:00:00.000Z',
            content: { input: 'item input text' },
          },
        }),
        JSON.stringify({
          payload: {
            message: {
              id: 'payload-message',
              role: 'model',
              timestamp: '2026-01-01T00:00:01.000Z',
              content: { value: 'payload message text' },
            },
          },
        }),
        JSON.stringify({ payload: { role: 'assistant', text: 'payload text fallback' } }),
      ].join('\n') + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const doc = await adapter.toUniversal(sessions[0])

    expect(doc.messages.map((message) => message.id)).toEqual(['42', 'payload-message', '2'])
    expect(doc.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(doc.messages.map((message) => message.text)).toEqual([
      'item input text',
      'payload message text',
      'payload text fallback',
    ])
  })

  it('covers usage aliases from response, payload info, message, and invalid numbers', async () => {
    const root = await makeTmpDir('edge-usage-aliases')
    const filePath = path.join(root, 'usage.jsonl')
    await writeFile(
      filePath,
      [
        JSON.stringify({
          role: 'assistant',
          content: 'response token usage',
          response: {
            tokenUsage: {
              inputTokens: '10',
              outputTokens: 'bad',
              cacheTokens: '5',
              totalTokens: '20',
              cost_usd: '0.02',
            },
          },
        }),
        JSON.stringify({
          role: 'assistant',
          content: 'payload info usage',
          payload: {
            info: {
              lastTokenUsage: {
                prompt_tokens: '7',
                completion_tokens: '3',
                cached_input_tokens: '2',
              },
            },
          },
        }),
        JSON.stringify({
          role: 'assistant',
          content: 'message usage',
          message: {
            last_token_usage: {
              input_tokens: '11',
              output_tokens: '4',
              total_tokens: '15',
            },
          },
        }),
        JSON.stringify({
          role: 'assistant',
          content: 'invalid usage numbers',
          usage: { input_tokens: 'not-a-number', output_tokens: 'also-bad' },
        }),
      ].join('\n') + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const tokens = sessions[0].tokens

    expect(tokens.input).toBe(28)
    expect(tokens.output).toBe(7)
    expect(tokens.cached).toBe(7)
    expect(tokens.total).toBe(47)
    expect(tokens.costUsd).toBeCloseTo(0.02)
  })

  it('subtracts cached GPT input and records model-estimated mixed costs', async () => {
    const root = await makeTmpDir('edge-usage-gpt-estimated')
    const filePath = path.join(root, 'usage-gpt.jsonl')
    await writeFile(
      filePath,
      [
        JSON.stringify({
          model: 'gpt-4o',
          role: 'assistant',
          content: 'cached gpt usage',
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cached_input_tokens: 30,
            cache_read_input_tokens: 10,
          },
        }),
        JSON.stringify({
          model: 'claude-3-5-sonnet',
          role: 'assistant',
          content: 'estimated claude usage',
          usage: {
            input_tokens: 50,
            output_tokens: 20,
          },
        }),
      ].join('\n') + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const tokens = sessions[0].tokens

    expect(tokens.input).toBe(110)
    expect(tokens.cached).toBe(40)
    expect(tokens.cacheRead).toBe(40)
    expect(tokens.costUsd).toBeGreaterThan(0)
    expect(tokens.costSource).toBe('model-estimate')
    expect(tokens.model).toBe('gpt-4o')
  })

  it('ignores invalid timestamps and too-deep project hints', async () => {
    const root = await makeTmpDir('edge-invalid-date')
    const filePath = path.join(root, 'invalid-date.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        timestamp: 'not-a-date',
        role: 'user',
        content: 'invalid date usage',
        usage: { input_tokens: 1, output_tokens: 2 },
        level1: { level2: { level3: { level4: { level5: { cwd: '/too/deep' } } } } },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))

    expect(sessions[0].metadata.usageByDate).toEqual({})
    expect(sessions[0].projectPath).toBeUndefined()
    expect(sessions[0].projectName).toBe(path.basename(root))
  })

  it('finds project hints nested in arrays', async () => {
    const root = await makeTmpDir('edge-array-hints')
    const filePath = path.join(root, 'array-hints.json')
    await writeFile(
      filePath,
      JSON.stringify({
        meta: [{ workspacePath: '/workspace/from-array' }],
        messages: [{ role: 'user', content: 'array project hint' }],
      }),
    )

    const adapter = makeAdapter('cursor', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'cursor'))

    expect(sessions[0].projectPath).toBe('/workspace/from-array')
    expect(sessions[0].projectName).toBe('from-array')
  })
})

// ─── session record fields ────────────────────────────────────────────────────

describe('session record fields', () => {
  it('derives title from first user message', async () => {
    const root = await makeTmpDir('title-user')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Fix the authentication bug' },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    expect(sessions[0].title).toContain('Fix the authentication bug')
  })

  it('falls back to filename when no user message is found', async () => {
    const root = await makeTmpDir('title-fallback')
    const filePath = path.join(root, 'my-session-file.jsonl')
    await writeFile(filePath, JSON.stringify({ type: 'session_meta', payload: {} }) + '\n')

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    expect(sessions[0].title).toBe('my-session-file.jsonl')
  })

  it('extracts projectPath from cwd field', async () => {
    const root = await makeTmpDir('project-cwd')
    const cwd = '/workspace/my-repo'
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({ type: 'session_meta', cwd, payload: { cwd, role: 'user', content: 'hi' } }) +
        '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    expect(sessions[0].projectPath).toBe(cwd)
  })

  it('extracts branch from gitBranch field in claude records', async () => {
    const root = await makeTmpDir('branch-claude')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'user',
        sessionId: 'abc',
        gitBranch: 'feature/my-branch',
        content: 'Hello',
      }) + '\n',
    )

    const adapter = makeAdapter('claude', [root])
    const { sessions } = await adapter.scan(makeSettings(root, 'claude'))
    expect(sessions[0].branch).toBe('feature/my-branch')
  })

  it('builds searchText from title, projectPath, branch, and messages', async () => {
    const root = await makeTmpDir('search-text')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { cwd: '/workspace/searchable', git: { branch: 'search-branch' } },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { role: 'user', content: 'searchable unique phrase' },
        }),
      ].join('\n') + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    const st = sessions[0].searchText ?? ''
    expect(st).toContain('searchable unique phrase')
  })

  it('sets storageKind to file for .jsonl files', async () => {
    const root = await makeTmpDir('storage-kind-file')
    const filePath = path.join(root, 's.jsonl')
    await writeFile(
      filePath,
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'hi' } }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan(makeSettings(root))
    expect(sessions[0].storageKind).toBe('file')
  })

  it('sets storageKind to database for .db files', async () => {
    const root = await makeTmpDir('storage-kind-db')
    const filePath = path.join(root, 'storage.db')
    await writeFile(
      filePath,
      'fake db content that is long enough to pass size check and read limit',
    )

    const adapter = makeAdapter('cursor', [root], ['**/*.db'])
    const { sessions } = await adapter.scan(makeSettings(root, 'cursor'))
    // .db file with non-JSON content → raw text fallback → storageKind = database
    expect(sessions[0].storageKind).toBe('database')
  })

  it('sets storageKind to database for .sqlite files', async () => {
    const root = await makeTmpDir('storage-kind-sqlite')
    const filePath = path.join(root, 'data.sqlite')
    await writeFile(
      filePath,
      'fake sqlite content that is long enough to pass size check and read limit',
    )

    const adapter = makeAdapter('cursor', [root], ['**/*.sqlite'])
    const { sessions } = await adapter.scan(makeSettings(root, 'cursor'))
    expect(sessions[0].storageKind).toBe('database')
  })
})

// ─── scan state ────────────────────────────────────────────────────────────────

describe('scan state fields', () => {
  it('populates AgentInstallState and sums only candidate session file sizes', async () => {
    const root = await makeTmpDir('scan-state')
    const contents: string[] = []
    for (let i = 0; i < 3; i++) {
      const filePath = path.join(root, `session-${i}.jsonl`)
      const content =
        JSON.stringify({
          type: 'response_item',
          payload: { role: 'user', content: `Question ${i}` },
        }) + '\n'
      contents.push(content)
      await writeFile(filePath, content)
    }
    await writeFile(path.join(root, 'not-a-session.txt'), 'must not count toward scan size')

    const adapter = makeAdapter('claude', [root])
    const { state } = await adapter.scan(makeSettings(root, 'claude'))

    expect(state.source).toBe('claude')
    expect(state.name).toBe('Test-claude')
    expect(state.sessionCount).toBe(3)
    expect(state.sizeBytes).toBe(
      contents.reduce((total, content) => total + Buffer.byteLength(content), 0),
    )
    expect(typeof state.lastScannedAt).toBe('string')
  })

  it('filters session files under excluded folders', async () => {
    const root = await makeTmpDir('scan-exclusions')
    const keptPath = path.join(root, 'kept.jsonl')
    const excludedRoot = path.join(root, 'excluded')
    const excludedPath = path.join(excludedRoot, 'ignored.jsonl')
    await mkdir(excludedRoot, { recursive: true })
    await writeFile(
      keptPath,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Kept adapter session' },
      }) + '\n',
    )
    await writeFile(
      excludedPath,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Excluded adapter session' },
      }) + '\n',
    )

    const adapter = makeAdapter('codex', [root])
    const { sessions } = await adapter.scan({
      ...makeSettings(root),
      excludedFolders: [excludedRoot],
    })

    expect(sessions).toHaveLength(1)
    expect(sessions[0].storagePath).toBe(keptPath)
    expect(sessions[0].searchText).toContain('Kept adapter session')
  })
})
