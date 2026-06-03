import path from 'node:path'
import { stat } from 'node:fs/promises'
import type {
  AgentInstallState,
  AgentSource,
  AppSettings,
  SessionRecord,
  TokenUsage,
  UniversalRelayDocument,
  UniversalRelayMessage,
} from '../../src/shared/types'
import { expandHome, hashId, listFiles, mtimeIso, pathSize, readable, safeReadText } from './files'

type AgentDefinition = {
  source: AgentSource
  name: string
  roots: string[]
  patterns: string[]
  note: string
}

type ParsedSession = {
  title?: string
  projectPath?: string
  branch?: string
  messages: UniversalRelayMessage[]
  tokens: TokenUsage
  metadata: Record<string, unknown>
}

const emptyTokens = (): TokenUsage => ({
  input: 0,
  output: 0,
  cached: 0,
  total: 0,
  estimated: true,
})

const definitions: AgentDefinition[] = [
  {
    source: 'codex',
    name: 'Codex',
    roots: ['~/.codex/sessions', '~/.codex/tasks', '~/.codex/archived_sessions'],
    patterns: ['**/*.jsonl', '**/*.json'],
    note: 'Scans Codex CLI/App session JSONL data.',
  },
  {
    source: 'claude',
    name: 'Claude Code',
    roots: ['~/.claude/projects', '~/.claude/transcripts'],
    patterns: ['**/*.jsonl', '**/*.json'],
    note: 'Scans Claude Code project transcripts.',
  },
  {
    source: 'cursor',
    name: 'Cursor',
    roots: [
      '~/Library/Application Support/Cursor/User/workspaceStorage',
      '~/Library/Application Support/Cursor/User/globalStorage',
    ],
    patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.log'],
    note: 'Read-only scan of Cursor workspace storage and chat artifacts.',
  },
  {
    source: 'gemini',
    name: 'Gemini',
    roots: ['~/.gemini', '~/.config/gemini', '~/Library/Application Support/Gemini'],
    patterns: ['**/*.json', '**/*.jsonl', '**/*.md', '**/*.log'],
    note: 'Scans configurable Gemini CLI/session storage roots.',
  },
  {
    source: 'opencode',
    name: 'OpenCode',
    roots: ['~/.local/share/opencode', '~/Library/Application Support/opencode', '~/.opencode'],
    patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.md', '**/*.log'],
    note: 'Scans OpenCode data roots using a generic session parser.',
  },
]

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join('\n')

  const record = asRecord(value)
  if (!record) return ''

  return (
    asString(record.text) ??
    asString(record.content) ??
    asString(record.value) ??
    asString(record.input) ??
    ''
  )
}

function normalizeRole(value: unknown): UniversalRelayMessage['role'] {
  const role = String(value ?? '').toLowerCase()
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') return role
  if (role.includes('human')) return 'user'
  if (role.includes('model')) return 'assistant'
  return 'unknown'
}

function findStringByKeys(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 4) return undefined
  const record = asRecord(value)
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findStringByKeys(item, keys, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }

  for (const key of keys) {
    const direct = asString(record[key])
    if (direct) return direct
  }

  for (const item of Object.values(record)) {
    const found = findStringByKeys(item, keys, depth + 1)
    if (found) return found
  }

  return undefined
}

function extractUsage(value: unknown): TokenUsage {
  const tokens = emptyTokens()

  function addUsage(node: unknown): void {
    const record = asRecord(node)
    if (!record) return

    const input =
      Number(record.input_tokens ?? record.prompt_tokens ?? record.promptTokens ?? record.inputTokens) || 0
    const output =
      Number(record.output_tokens ?? record.completion_tokens ?? record.completionTokens ?? record.outputTokens) || 0
    const cached =
      Number(record.cached_tokens ?? record.cache_read_input_tokens ?? record.cachedTokens ?? record.cacheTokens) || 0
    const total = Number(record.total_tokens ?? record.totalTokens) || input + output + cached

    if (input || output || cached || total) {
      tokens.input += input
      tokens.output += output
      tokens.cached += cached
      tokens.total += total
      tokens.estimated = false
    }
  }

  function visit(node: unknown, depth = 0): void {
    if (depth > 4) return
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1))
      return
    }

    const record = asRecord(node)
    if (!record) return

    addUsage(record.usage)
    addUsage(record.token_usage)
    addUsage(record.tokenUsage)

    const response = asRecord(record.response)
    if (response) {
      addUsage(response.usage)
      addUsage(response.token_usage)
      addUsage(response.tokenUsage)
    }

    const payload = asRecord(record.payload)
    if (payload) {
      addUsage(payload.usage)
      addUsage(payload.token_usage)
      addUsage(payload.tokenUsage)
      visit(payload, depth + 1)
    }

    const message = asRecord(record.message)
    if (message) {
      addUsage(message.usage)
      addUsage(message.token_usage)
      addUsage(message.tokenUsage)
    }
  }

  visit(value)
  return tokens
}

function extractMessage(value: unknown, fallbackId: string): UniversalRelayMessage | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const payload = asRecord(record.payload)
  const item =
    asRecord(record.item) ??
    asRecord(record.message) ??
    asRecord(payload?.item) ??
    asRecord(payload?.message) ??
    payload ??
    record
  const role = normalizeRole(item.role ?? record.role ?? item.type ?? record.type)
  const text =
    textFromContent(item.content) ||
    textFromContent(record.content) ||
    textFromContent(item.text) ||
    textFromContent(record.text) ||
    textFromContent(item.parts) ||
    textFromContent(payload?.content) ||
    textFromContent(payload?.text)

  if (!text.trim()) return undefined
  return {
    id: asString(item.id) ?? asString(record.id) ?? asString(payload?.id) ?? fallbackId,
    role,
    createdAt:
      asString(item.created_at) ??
      asString(record.created_at) ??
      asString(item.timestamp) ??
      asString(record.timestamp) ??
      asString(payload?.timestamp),
    text: text.trim(),
    raw: value,
  }
}

function firstTitle(messages: UniversalRelayMessage[], fallback: string): string {
  const userMessage = messages.find((message) => message.role === 'user' && message.text.length > 0)
  const text = userMessage?.text ?? fallback
  return text.replace(/\s+/g, ' ').trim().slice(0, 72) || fallback
}

function projectNameFromPath(projectPath: string | undefined, filePath: string): string {
  if (projectPath) return path.basename(projectPath)
  const parent = path.basename(path.dirname(filePath))
  if (parent && parent !== '.' && parent !== '..') return parent
  return 'Unknown Project'
}

async function parseJsonLike(filePath: string): Promise<ParsedSession> {
  const text = await safeReadText(filePath)
  const messages: UniversalRelayMessage[] = []
  const metadata: Record<string, unknown> = {}
  let tokens = emptyTokens()

  if (filePath.endsWith('.jsonl')) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    lines.slice(0, 3000).forEach((line, index) => {
      try {
        const json = JSON.parse(line) as unknown
        const message = extractMessage(json, `${index}`)
        if (message) messages.push(message)
        const usage = extractUsage(json)
        tokens.input += usage.input
        tokens.output += usage.output
        tokens.cached += usage.cached
        tokens.total += usage.total
        tokens.estimated = tokens.estimated && usage.estimated
        metadata.sample = metadata.sample ?? json
      } catch {
        if (line.length > 24) {
          messages.push({
            id: `${index}`,
            role: 'unknown',
            text: line.slice(0, 4000),
          })
        }
      }
    })
  } else if (filePath.endsWith('.json')) {
    try {
      const json = JSON.parse(text) as unknown
      metadata.sample = json
      const record = asRecord(json)
      const array =
        (Array.isArray(json) && json) ||
        (Array.isArray(record?.messages) && record?.messages) ||
        (Array.isArray(record?.conversation) && record?.conversation) ||
        (Array.isArray(record?.entries) && record?.entries) ||
        []
      array.slice(0, 3000).forEach((item, index) => {
        const message = extractMessage(item, `${index}`)
        if (message) messages.push(message)
      })
      tokens = extractUsage(json)
    } catch {
      messages.push({ id: 'raw', role: 'unknown', text: text.slice(0, 4000) })
    }
  } else {
    text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(0, 200)
      .forEach((line, index) => {
        messages.push({ id: `${index}`, role: 'unknown', text: line.slice(0, 1000) })
      })
  }

  return {
    title: firstTitle(messages, path.basename(filePath)),
    projectPath: findStringByKeys(metadata.sample, ['cwd', 'projectPath', 'project_path', 'workspace', 'workspacePath']),
    branch: findStringByKeys(metadata.sample, ['branch', 'gitBranch', 'git_branch']),
    messages,
    tokens,
    metadata,
  }
}

export class AgentAdapter {
  private readonly definition: AgentDefinition

  constructor(definition: AgentDefinition) {
    this.definition = definition
  }

  get source(): AgentSource {
    return this.definition.source
  }

  get name(): string {
    return this.definition.name
  }

  roots(settings: AppSettings): string[] {
    const configured = settings.scanRoots[this.definition.source]
    return (configured?.length ? configured : this.definition.roots).map(expandHome)
  }

  async scan(settings: AppSettings): Promise<{ state: AgentInstallState; sessions: SessionRecord[] }> {
    const roots = this.roots(settings)
    const readableRoots = []
    for (const root of roots) {
      if (await readable(root)) readableRoots.push(root)
    }

    const files = (
      await Promise.all(readableRoots.map((root) => listFiles(root, this.definition.patterns)))
    ).flat()

    const sessions: SessionRecord[] = []
    for (const filePath of files) {
      try {
        const info = await stat(filePath)
        if (info.size === 0) continue
        if (info.size > 250_000_000) continue

        const parsed = await parseJsonLike(filePath)
        const id = hashId([this.definition.source, filePath])
        sessions.push({
          id,
          source: this.definition.source,
          title: parsed.title ?? path.basename(filePath),
          projectName: projectNameFromPath(parsed.projectPath, filePath),
          projectPath: parsed.projectPath,
          branch: parsed.branch,
          storagePath: filePath,
          storageKind: filePath.endsWith('.db') || filePath.endsWith('.sqlite') ? 'database' : 'file',
          createdAt: info.birthtime.toISOString(),
          lastUpdated: (await mtimeIso(filePath)) || info.mtime.toISOString(),
          messageCount: parsed.messages.length,
          tokens: parsed.tokens,
          sizeBytes: info.size,
          backupStatus: 'pending',
          tags: [this.definition.source],
          metadata: {
            parser: 'generic-json-session-parser',
            root: readableRoots.find((root) => filePath.startsWith(root)),
            relativePath: readableRoots
              .map((root) => (filePath.startsWith(root) ? path.relative(root, filePath) : undefined))
              .find(Boolean),
          },
        })
      } catch {
        continue
      }
    }

    const sizeBytes = await readableRoots.reduce<Promise<number>>(async (promise, root) => {
      const total = await promise
      try {
        return total + (await pathSize(root, 400))
      } catch {
        return total
      }
    }, Promise.resolve(0))

    return {
      state: {
        source: this.definition.source,
        name: this.definition.name,
        installed: readableRoots.length > 0,
        readable: readableRoots.length > 0,
        rootPaths: roots,
        sessionCount: sessions.length,
        sizeBytes,
        lastScannedAt: new Date().toISOString(),
        note: this.definition.note,
      },
      sessions,
    }
  }

  async toUniversal(session: SessionRecord): Promise<UniversalRelayDocument> {
    const parsed = await parseJsonLike(session.storagePath)
    return {
      schema: 'clean-my-agent.universal-session.v1',
      exportedAt: new Date().toISOString(),
      source: session.source,
      session,
      messages: parsed.messages,
      files: [],
      commands: [],
      git: {
        branch: session.branch,
        projectPath: session.projectPath,
      },
      attachments: [],
      warnings: [
        'This is a generic relay export. Agent-specific import converters can transform this document later.',
      ],
    }
  }
}

export const adapters = definitions.map((definition) => new AgentAdapter(definition))

export function adapterFor(source: AgentSource): AgentAdapter {
  const adapter = adapters.find((item) => item.source === source)
  if (!adapter) throw new Error(`Unsupported agent source: ${source}`)
  return adapter
}
