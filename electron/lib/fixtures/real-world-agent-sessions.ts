import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentSource, SessionRecord } from '../../../src/shared/types'

type SqliteStatement = {
  run: (...values: unknown[]) => unknown
}

type SqliteDatabase = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

type SqliteModule = {
  DatabaseSync: new (filePath: string) => SqliteDatabase
}

export type CompatibilityFixtureExpectation = {
  phrase: string
  projectPath: string
  branch?: string
  sourceFormat?: string
  storageKind: SessionRecord['storageKind']
  minMessages: number
  minTokens: number
}

export type RealWorldAgentFixtureLibrary = {
  root: string
  scanRoots: Partial<Record<AgentSource, string[]>>
  expectations: Record<
    'codex' | 'claude' | 'cursor' | 'gemini' | 'opencode' | 'pi',
    CompatibilityFixtureExpectation
  >
  ignoredCredentialPhrase: string
}

const timestamp = '2026-06-08T10:15:30.000Z'
const ignoredCredentialPhrase = 'DO_NOT_SCAN_CREDENTIAL_LIKE_FIXTURE'

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2))
}

async function writeJsonl(filePath: string, values: unknown[], suffix = ''): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const lines = values.map((value) => JSON.stringify(value))
  await writeFile(filePath, `${lines.join('\n')}${suffix}\n`)
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value)
}

async function writeCursorStateDb(filePath: string, projectPath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const sqlite = (await import('node:sqlite')) as unknown as SqliteModule
  const db = new sqlite.DatabaseSync(filePath)
  try {
    db.exec(`
      CREATE TABLE ItemTable (
        key TEXT PRIMARY KEY,
        value BLOB
      );
      CREATE TABLE cursorDiskKV (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    const composerData = {
      workspacePath: projectPath,
      allComposers: [
        {
          composerId: 'composer-dirty-fixture',
          conversation: [
            {
              role: 'user',
              timestamp,
              content: [{ type: 'text', text: 'Cursor composer dirty prompt' }],
              command: 'pnpm test -- --runInBand',
              files: [{ path: path.join(projectPath, 'src/cursor.ts') }],
            },
            {
              role: 'assistant',
              timestamp,
              content: [{ type: 'text', text: 'Cursor composer dirty response' }],
              usage: { promptTokens: 31, completionTokens: 17 },
            },
          ],
        },
      ],
    }
    db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
      'composer.composerData',
      JSON.stringify(composerData),
    )
    db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
      'workbench.panel.aichat.broken',
      '{this is not valid json',
    )
    db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
      'workbench.backgroundComposer.workspacePersistentData',
      JSON.stringify({
        workspacePath: projectPath,
        messages: [
          {
            role: 'user',
            timestamp,
            content: 'Cursor background composer recovery prompt',
          },
        ],
      }),
    )
  } finally {
    db.close()
  }
}

export async function writeRealWorldAgentFixtures(
  root: string,
): Promise<RealWorldAgentFixtureLibrary> {
  const home = path.join(root, 'home')
  const codexRoot = path.join(home, '.codex')
  const claudeRoot = path.join(home, '.claude')
  const cursorRoot = path.join(home, 'Library', 'Application Support', 'Cursor', 'User')
  const geminiRoot = path.join(home, '.gemini')
  const opencodeRoot = path.join(home, '.local', 'share', 'opencode')

  const codexProject = path.join(home, 'workspaces', 'codex-real')
  await writeJsonl(
    path.join(codexRoot, 'sessions', '2026', '06', '08', 'codex-dirty-session.jsonl'),
    [
      {
        type: 'session_meta',
        timestamp,
        payload: {
          id: 'codex-dirty-session',
          cwd: codexProject,
          git: { branch: 'codex/fixture-compat' },
        },
      },
      {
        type: 'response_item',
        timestamp,
        payload: {
          id: 'codex-user-1',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Codex dirty compatibility prompt' },
            { type: 'text', text: 'Includes content blocks and a later malformed JSONL line.' },
          ],
          usage: { input_tokens: 40, output_tokens: 0, total_tokens: 40 },
        },
      },
      {
        type: 'event_msg',
        timestamp,
        payload: {
          type: 'token_count',
          model: 'gpt-5-codex',
          last_token_usage: {
            input_tokens: 10,
            cached_input_tokens: 4,
            output_tokens: 12,
            total_tokens: 26,
          },
        },
      },
      {
        type: 'response_item',
        timestamp,
        payload: {
          id: 'codex-assistant-1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Codex dirty compatibility response' }],
        },
      },
    ],
    '\n{"type":"response_item","payload":{"role":"assistant","content":"truncated"',
  )
  await writeText(path.join(codexRoot, 'sessions', '2026', '06', '08', 'empty.jsonl'), '')
  await writeJson(path.join(codexRoot, 'oauth-token-cache.json'), {
    content: ignoredCredentialPhrase,
  })

  const claudeProject = path.join(home, 'workspaces', 'claude-real')
  await writeJsonl(path.join(claudeRoot, 'projects', '-Users-demo-claude-real', 'session.jsonl'), [
    {
      type: 'user',
      uuid: 'claude-user-1',
      timestamp,
      cwd: claudeProject,
      gitBranch: 'claude/fixture-compat',
      sessionId: 'claude-dirty-session',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Claude timestamped dirty prompt' },
          { type: 'tool_result', content: 'kept as text block fallback' },
        ],
      },
    },
    {
      type: 'assistant',
      uuid: 'claude-assistant-1',
      timestamp,
      sessionId: 'claude-dirty-session',
      message: {
        id: 'claude-message-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Claude timestamped dirty response' }],
        usage: {
          input_tokens: 70,
          output_tokens: 25,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    },
    {
      type: 'queue-operation',
      timestamp,
      sessionId: 'claude-dirty-session',
      content: '',
    },
  ])
  await writeJson(
    path.join(claudeRoot, 'projects', '-Users-demo-claude-real', 'credential-store.json'),
    {
      content: ignoredCredentialPhrase,
    },
  )

  const cursorProject = path.join(home, 'workspaces', 'cursor-real')
  const cursorWorkspaceRoot = path.join(cursorRoot, 'workspaceStorage', 'cursorhash123')
  await writeJson(path.join(cursorWorkspaceRoot, 'workspace.json'), {
    folder: cursorProject,
  })
  await writeCursorStateDb(path.join(cursorWorkspaceRoot, 'state.vscdb'), cursorProject)
  await writeJson(path.join(cursorRoot, 'globalStorage', 'cursor-token-cache.json'), {
    content: ignoredCredentialPhrase,
  })

  const geminiProject = path.join(home, 'workspaces', 'gemini-real')
  await writeJson(path.join(geminiRoot, 'tmp', 'history', 'gemini-dirty.json'), {
    workspacePath: geminiProject,
    messages: [
      {
        role: 'user',
        timestamp,
        parts: [{ text: 'Gemini parts dirty prompt' }],
      },
      {
        role: 'model',
        timestamp,
        parts: [{ text: 'Gemini parts dirty response' }],
        usage: { promptTokens: 22, completionTokens: 9 },
      },
    ],
  })
  await writeText(
    path.join(geminiRoot, 'logs', 'debug.log'),
    'Gemini raw log fallback line one\n\nGemini raw log fallback line two\n',
  )
  await writeJson(path.join(geminiRoot, 'oauth-session.json'), {
    content: ignoredCredentialPhrase,
  })

  const opencodeProject = path.join(home, 'workspaces', 'opencode-real')
  await writeJson(path.join(opencodeRoot, 'storage', 'session', 'opencode-dirty.json'), {
    sessionID: 'opencode-dirty-session',
    workspacePath: opencodeProject,
    branch: 'opencode/fixture-compat',
    history: {
      messages: [
        {
          role: 'user',
          timestamp,
          content: 'OpenCode nested dirty prompt',
          files: [{ path: path.join(opencodeProject, 'src/opencode.ts') }],
        },
        {
          role: 'assistant',
          timestamp,
          content: 'OpenCode nested dirty response',
          usage: { input_tokens: 44, output_tokens: 16 },
        },
      ],
    },
  })
  await writeJson(path.join(opencodeRoot, 'storage', 'session_diff', 'opencode-dirty.json'), [
    {
      sessionID: 'opencode-dirty-session',
      path: path.join(opencodeProject, 'src/opencode.ts'),
      diff: 'diff --git a/src/opencode.ts b/src/opencode.ts\n@@ -1 +1 @@\n-old\n+new\n',
    },
  ])
  await writeJson(path.join(opencodeRoot, 'secret-session.json'), {
    content: ignoredCredentialPhrase,
  })

  const piProject = path.join(home, 'workspaces', 'pi-real')
  const piRoot = path.join(home, '.pi', 'agent', 'sessions')
  await writeJsonl(
    path.join(piRoot, '--Users-demo-pi-real--', '2026-06-08T10-15-30-000Z_pi-dirty-session.jsonl'),
    [
      {
        type: 'session',
        version: 3,
        id: 'pi-dirty-session',
        timestamp,
        cwd: piProject,
      },
      {
        type: 'message',
        id: 'pi-user-1',
        parentId: null,
        timestamp,
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi dirty compatibility prompt' }],
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
          content: [{ type: 'text', text: 'Pi dirty compatibility response' }],
          usage: {
            input: 80,
            output: 20,
            cacheRead: 5,
            cacheWrite: 30,
            totalTokens: 130,
          },
        },
      },
    ],
  )
  // Credential-like files live in the parent ~/.pi/agent/ directory, above the
  // sessions scan root, and must never be scanned.
  await writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
    content: ignoredCredentialPhrase,
  })
  await writeJson(path.join(home, '.pi', 'agent', 'models.json'), {
    content: ignoredCredentialPhrase,
  })

  return {
    root,
    scanRoots: {
      codex: [codexRoot],
      claude: [claudeRoot],
      cursor: [cursorRoot],
      gemini: [geminiRoot],
      opencode: [opencodeRoot],
      pi: [piRoot],
    },
    expectations: {
      codex: {
        phrase: 'Codex dirty compatibility prompt',
        projectPath: codexProject,
        branch: 'codex/fixture-compat',
        sourceFormat: 'codex-jsonl',
        storageKind: 'file',
        minMessages: 3,
        minTokens: 60,
      },
      claude: {
        phrase: 'Claude timestamped dirty prompt',
        projectPath: claudeProject,
        branch: 'claude/fixture-compat',
        sourceFormat: 'claude-jsonl',
        storageKind: 'file',
        minMessages: 2,
        minTokens: 100,
      },
      cursor: {
        phrase: 'Cursor composer dirty prompt',
        projectPath: cursorProject,
        sourceFormat: 'cursor-state-sqlite',
        storageKind: 'database',
        minMessages: 2,
        minTokens: 40,
      },
      gemini: {
        phrase: 'Gemini parts dirty prompt',
        projectPath: geminiProject,
        storageKind: 'file',
        minMessages: 2,
        minTokens: 30,
      },
      opencode: {
        phrase: 'OpenCode nested dirty prompt',
        projectPath: opencodeProject,
        branch: 'opencode/fixture-compat',
        sourceFormat: 'opencode-storage-json',
        storageKind: 'file',
        minMessages: 2,
        minTokens: 60,
      },
      pi: {
        phrase: 'Pi dirty compatibility prompt',
        projectPath: piProject,
        sourceFormat: 'claude-jsonl',
        storageKind: 'file',
        minMessages: 2,
        minTokens: 100,
      },
    },
    ignoredCredentialPhrase,
  }
}
