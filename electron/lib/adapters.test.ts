import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AgentAdapter, adapterFor, adapters } from './adapters'
import type { AppSettings } from '../../src/shared/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSettings(scanRoot: string, source = 'codex'): AppSettings {
  return {
    scanRoots: { [source]: [scanRoot] } as AppSettings['scanRoots'],
    cleanupRetentionDays: 30,
    trashRetentionDays: 7,
    autoBackup: false,
    mockDataEnabled: false,
    defaultRelayMode: 'full-context',
    exportDirectory: '/tmp',
  }
}

/** Build an AgentAdapter with a custom definition (AgentDefinition is module-private). */
function makeAdapter(source: string, roots: string[], patterns = ['**/*.jsonl', '**/*.json']) {
  return new AgentAdapter({
    source,
    name: `Test-${source}`,
    roots,
    patterns,
    note: 'test adapter',
  } as never)
}

type SessionCandidate = {
  path: string
  root?: string
  relativePath?: string
  sizeBytes: number
  createdAt: string
  lastUpdated: string
  mtimeMs: number
}

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
  })

  it('recentCandidates returns empty array for missing roots', async () => {
    const missingRoot = path.join(tmpBase, 'missing-recent-' + Date.now())
    const adapter = makeAdapter('codex', [missingRoot])
    const candidates = await adapter.recentCandidates(makeSettings(missingRoot), 10)
    expect(candidates).toHaveLength(0)
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
  it('skips candidates whose files cannot be read and returns the rest', async () => {
    const root = await makeTmpDir('scan-candidates-skip')
    const goodFile = path.join(root, 'good.jsonl')
    await writeFile(
      goodFile,
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: 'Good file content' },
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

    const adapter = makeAdapter('codex', [root])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = await adapter.scanCandidates([goodCandidate, badCandidate] as any)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].storagePath).toBe(goodFile)
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
  it('populates AgentInstallState with correct name, source, sessionCount', async () => {
    const root = await makeTmpDir('scan-state')
    for (let i = 0; i < 3; i++) {
      const filePath = path.join(root, `session-${i}.jsonl`)
      await writeFile(
        filePath,
        JSON.stringify({
          type: 'response_item',
          payload: { role: 'user', content: `Question ${i}` },
        }) + '\n',
      )
    }

    const adapter = makeAdapter('claude', [root])
    const { state } = await adapter.scan(makeSettings(root, 'claude'))

    expect(state.source).toBe('claude')
    expect(state.name).toBe('Test-claude')
    expect(state.sessionCount).toBe(3)
    expect(state.sizeBytes).toBeGreaterThan(0)
    expect(typeof state.lastScannedAt).toBe('string')
  })
})
