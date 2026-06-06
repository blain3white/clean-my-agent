import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type {
  AgentInstallState,
  AgentSource,
  AppSettings,
  SessionRecord,
  TokenCostSource,
  TokenUsage,
  UniversalRelayDocument,
  UniversalRelayMessage,
} from '../../src/shared/types'
import { agentSources } from '../../src/shared/types'
import { calculateUsageModelCost } from '../../src/shared/usage-pricing'
import {
  asString,
  isClaudeJsonlRecord,
  isCodexJsonlRecord,
  isCursorWorkspaceRecord,
  isOpenCodeStorageRecord,
  toRecord,
  type JsonRecord,
} from './agent-storage-formats'
import { expandHome, hashId, listFiles, pathSize, readable, safeReadText } from './files'

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
  usageByDate: Record<string, number>
  metadata: JsonRecord
}

type SessionFileCandidate = {
  path: string
  root?: string
  relativePath?: string
  sizeBytes: number
  createdAt: string
  lastUpdated: string
  mtimeMs: number
}

const emptyTokens = (): TokenUsage => ({
  input: 0,
  output: 0,
  cached: 0,
  cacheCreation: 0,
  cacheRead: 0,
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
  {
    source: 'custom',
    name: 'Custom',
    roots: [],
    patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.md', '**/*.log'],
    note: 'Scans user-selected custom session folders with the generic parser.',
  },
]

function normalizePathForCompare(value: string): string {
  return path.resolve(expandHome(value)).replace(/[\\/]+$/, '')
}

function isInsidePath(filePath: string, parentPath: string): boolean {
  const file = normalizePathForCompare(filePath)
  const parent = normalizePathForCompare(parentPath)
  return file === parent || file.startsWith(`${parent}${path.sep}`)
}

export function enabledProviderSources(settings: AppSettings): AgentSource[] {
  return agentSources.filter((source) => settings.enabledProviders[source] !== false)
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join('\n')

  const record = toRecord(value)
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
  const record = toRecord(value)
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

function dateKeyFromRecord(record: JsonRecord): string | undefined {
  const payload = toRecord(record.payload)
  const message = toRecord(record.message)
  const timestamp =
    asString(record.timestamp) ??
    asString(record.created_at) ??
    asString(record.createdAt) ??
    asString(message?.timestamp) ??
    asString(message?.created_at) ??
    asString(message?.createdAt) ??
    asString(payload?.timestamp) ??
    asString(payload?.created_at) ??
    asString(payload?.createdAt)

  if (!timestamp) return undefined
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

function numberFromRecord(record: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }

  return 0
}

function optionalNumberFromRecord(
  record: JsonRecord | undefined,
  keys: string[],
): number | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  }

  return undefined
}

function usageModel(
  record: JsonRecord,
  parent?: JsonRecord,
  fallbackModel?: string,
): string | undefined {
  const payload = toRecord(parent?.payload)
  const message = toRecord(parent?.message)
  const parentResponse = toRecord(parent?.response)
  const payloadMessage = toRecord(payload?.message)
  const payloadInfo = toRecord(payload?.info)
  const candidates: unknown[] = [
    record.model,
    record.modelName,
    record.model_name,
    record.modelID,
    record.modelId,
    record.model_id,
    parent?.model,
    parent?.modelName,
    parent?.model_name,
    parent?.modelID,
    parent?.modelId,
    parent?.model_id,
    message?.model,
    message?.modelName,
    message?.model_name,
    payload?.model,
    payload?.modelName,
    payload?.model_name,
    payload?.modelID,
    payload?.modelId,
    payload?.model_id,
    payloadMessage?.model,
    payloadMessage?.modelName,
    payloadMessage?.model_name,
    payloadInfo?.model,
    payloadInfo?.modelName,
    payloadInfo?.model_name,
    parentResponse?.model,
    parentResponse?.modelName,
    parentResponse?.model_name,
  ]

  for (const candidate of candidates) {
    const value = asString(candidate)
    if (value) return value
  }

  return fallbackModel
}

function modelHintFromRecord(record: JsonRecord): string | undefined {
  return usageModel(record)
}

function mergeCostSource(
  left: TokenCostSource | undefined,
  right: TokenCostSource | undefined,
): TokenCostSource | undefined {
  if (!left) return right
  if (!right || left === right) return left
  return 'mixed'
}

function setUsageCost(tokens: TokenUsage, costUsd: number, source: TokenCostSource): void {
  tokens.costUsd = (tokens.costUsd ?? 0) + costUsd
  tokens.costSource = mergeCostSource(tokens.costSource, source)
}

function usageIdentity(record: JsonRecord): string | undefined {
  const message = toRecord(record.message)
  const payload = toRecord(record.payload)
  const payloadMessage = toRecord(payload?.message)
  const payloadItem = toRecord(payload?.item)
  return (
    asString(message?.id) ??
    asString(payloadMessage?.id) ??
    asString(payloadItem?.id) ??
    asString(record.uuid) ??
    asString(record.id)
  )
}

function addTokens(target: TokenUsage, usage: TokenUsage): void {
  target.input += usage.input
  target.output += usage.output
  target.cached += usage.cached
  target.cacheCreation = (target.cacheCreation ?? 0) + (usage.cacheCreation ?? 0)
  target.cacheRead = (target.cacheRead ?? 0) + (usage.cacheRead ?? 0)
  target.total += usage.total
  if (typeof usage.costUsd === 'number') {
    setUsageCost(target, usage.costUsd, usage.costSource ?? 'actual')
  }
  target.model ??= usage.model
  target.estimated = target.estimated && usage.estimated
}

function extractUsage(
  value: unknown,
  seenUsageIds = new Set<string>(),
  fallbackModel?: string,
): TokenUsage {
  const tokens = emptyTokens()
  const seenUsageObjects = new WeakSet<JsonRecord>()

  function addUsage(node: unknown, parent?: JsonRecord): void {
    const record = toRecord(node)
    if (!record) return
    if (seenUsageObjects.has(record)) return
    seenUsageObjects.add(record)

    const identity = parent ? usageIdentity(parent) : undefined
    if (identity && seenUsageIds.has(identity)) return

    const rawInput = numberFromRecord(record, [
      'input_tokens',
      'prompt_tokens',
      'promptTokens',
      'inputTokens',
    ])
    const output = numberFromRecord(record, [
      'output_tokens',
      'completion_tokens',
      'completionTokens',
      'outputTokens',
    ])
    const cacheCreation = numberFromRecord(record, [
      'cache_creation_input_tokens',
      'cacheCreationInputTokens',
    ])
    const cacheRead = numberFromRecord(record, ['cache_read_input_tokens', 'cacheReadInputTokens'])
    const legacyCached = numberFromRecord(record, [
      'cached_tokens',
      'cached_input_tokens',
      'cachedTokens',
      'cachedInputTokens',
      'cacheTokens',
    ])
    const cached = cacheCreation + cacheRead + legacyCached
    const model = usageModel(record, parent, fallbackModel)
    const input =
      model?.toLowerCase().includes('gpt') || model?.toLowerCase().includes('codex')
        ? Math.max(0, rawInput - cacheRead - legacyCached)
        : rawInput
    const total =
      numberFromRecord(record, ['total_tokens', 'totalTokens']) || rawInput + output + cached
    const actualCostUsd =
      optionalNumberFromRecord(record, ['costUSD', 'costUsd', 'cost_usd', 'cost']) ??
      optionalNumberFromRecord(parent, ['costUSD', 'costUsd', 'cost_usd', 'cost'])
    const estimatedCostUsd =
      actualCostUsd === undefined
        ? calculateUsageModelCost({
            model,
            input,
            output,
            cacheCreation,
            cacheRead: cacheRead + legacyCached,
          })
        : undefined

    if (input || output || cached || total || actualCostUsd || estimatedCostUsd) {
      if (identity) seenUsageIds.add(identity)
      tokens.input += input
      tokens.output += output
      tokens.cached += cached
      tokens.cacheCreation = (tokens.cacheCreation ?? 0) + cacheCreation
      tokens.cacheRead = (tokens.cacheRead ?? 0) + cacheRead + legacyCached
      tokens.total += total
      tokens.model ??= model
      if (typeof actualCostUsd === 'number') {
        setUsageCost(tokens, actualCostUsd, 'actual')
      } else if (typeof estimatedCostUsd === 'number') {
        setUsageCost(tokens, estimatedCostUsd, 'model-estimate')
      }
      tokens.estimated = false
    }
  }

  function visit(node: unknown, depth = 0): void {
    if (depth > 4) return
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1))
      return
    }

    const record = toRecord(node)
    if (!record) return

    addUsage(record.usage, record)
    addUsage(record.token_usage, record)
    addUsage(record.tokenUsage, record)
    addUsage(record.last_token_usage, record)
    addUsage(record.lastTokenUsage, record)

    const response = toRecord(record.response)
    if (response) {
      addUsage(response.usage, record)
      addUsage(response.token_usage, record)
      addUsage(response.tokenUsage, record)
      addUsage(response.last_token_usage, record)
      addUsage(response.lastTokenUsage, record)
    }

    const payload = toRecord(record.payload)
    if (payload) {
      addUsage(payload.usage, record)
      addUsage(payload.token_usage, record)
      addUsage(payload.tokenUsage, record)
      addUsage(payload.last_token_usage, record)
      addUsage(payload.lastTokenUsage, record)
      const info = toRecord(payload.info)
      if (info) {
        addUsage(info.usage, record)
        addUsage(info.token_usage, record)
        addUsage(info.tokenUsage, record)
        addUsage(info.last_token_usage, record)
        addUsage(info.lastTokenUsage, record)
      }
      visit(payload, depth + 1)
    }

    const message = toRecord(record.message)
    if (message) {
      addUsage(message.usage, record)
      addUsage(message.token_usage, record)
      addUsage(message.tokenUsage, record)
      addUsage(message.last_token_usage, record)
      addUsage(message.lastTokenUsage, record)
    }
  }

  visit(value)
  return tokens
}

function extractMessage(value: unknown, fallbackId: string): UniversalRelayMessage | undefined {
  const record = toRecord(value)
  if (!record) return undefined

  const payload = toRecord(record.payload)
  const item =
    toRecord(record.item) ??
    toRecord(record.message) ??
    toRecord(payload?.item) ??
    toRecord(payload?.message) ??
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

function searchTextFromParsed(parsed: ParsedSession): string {
  return [
    parsed.title,
    parsed.projectPath,
    parsed.branch,
    ...parsed.messages.slice(0, 40).map((message) => message.text),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16_000)
}

function projectNameFromPath(projectPath: string | undefined, filePath: string): string {
  if (projectPath) return path.basename(projectPath)
  const parent = path.basename(path.dirname(filePath))
  if (parent && parent !== '.' && parent !== '..') return parent
  return 'Unknown Project'
}

async function parseJsonLike(filePath: string): Promise<ParsedSession> {
  const messages: UniversalRelayMessage[] = []
  const metadata: JsonRecord = {}
  const usageByDate: Record<string, number> = {}
  let sampleForHints: unknown
  let tokens = emptyTokens()
  let currentModel: string | undefined

  if (filePath.endsWith('.jsonl')) {
    const seenUsageIds = new Set<string>()
    const lines = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    let index = 0

    for await (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line) as unknown
        if (isCodexJsonlRecord(json)) {
          metadata.sourceFormat = metadata.sourceFormat ?? 'codex-jsonl'
        } else if (isClaudeJsonlRecord(json)) {
          metadata.sourceFormat = metadata.sourceFormat ?? 'claude-jsonl'
        }
        if (messages.length < 3000) {
          const message = extractMessage(json, `${index}`)
          if (message) messages.push(message)
        }
        const record = toRecord(json)
        currentModel = record ? (modelHintFromRecord(record) ?? currentModel) : currentModel
        const usage = extractUsage(json, seenUsageIds, currentModel)
        addTokens(tokens, usage)
        const dateKey = record ? dateKeyFromRecord(record) : undefined
        if (dateKey && usage.total > 0)
          usageByDate[dateKey] = (usageByDate[dateKey] ?? 0) + usage.total
        sampleForHints ??= json
      } catch {
        if (messages.length < 3000 && line.length > 24) {
          messages.push({
            id: `${index}`,
            role: 'unknown',
            text: line.slice(0, 4000),
          })
        }
      }
      index += 1
    }
  } else if (filePath.endsWith('.json')) {
    const text = await safeReadText(filePath)
    try {
      const json = JSON.parse(text) as unknown
      sampleForHints = json
      if (isOpenCodeStorageRecord(json)) metadata.sourceFormat = 'opencode-storage-json'
      if (isCursorWorkspaceRecord(json)) metadata.sourceFormat = 'cursor-workspace-json'
      const record = toRecord(json)
      currentModel = record ? modelHintFromRecord(record) : undefined
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
      tokens = extractUsage(json, new Set<string>(), currentModel)
    } catch {
      messages.push({ id: 'raw', role: 'unknown', text: text.slice(0, 4000) })
    }
  } else {
    const text = await safeReadText(filePath)
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
    projectPath: findStringByKeys(sampleForHints, [
      'cwd',
      'projectPath',
      'project_path',
      'workspace',
      'workspacePath',
    ]),
    branch: findStringByKeys(sampleForHints, ['branch', 'gitBranch', 'git_branch']),
    messages,
    tokens,
    usageByDate,
    metadata: {
      ...metadata,
      usageByDate,
      costSource: tokens.costSource,
      model: tokens.model,
    },
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

  async recentCandidates(settings: AppSettings, limit: number): Promise<SessionFileCandidate[]> {
    const roots = await this.readableRoots(settings)
    const candidates = await this.fileCandidates(roots, settings.excludedFolders)
    return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
  }

  async scan(
    settings: AppSettings,
  ): Promise<{ state: AgentInstallState; sessions: SessionRecord[] }> {
    const roots = this.roots(settings)
    const readableRoots = await this.readableRoots(settings)
    const files = await this.fileCandidates(readableRoots, settings.excludedFolders)

    const sessions: SessionRecord[] = []
    for (const candidate of files) {
      try {
        sessions.push(await this.parseCandidate(candidate))
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

  async scanCandidates(candidates: SessionFileCandidate[]): Promise<SessionRecord[]> {
    const sessions: SessionRecord[] = []
    for (const candidate of candidates) {
      try {
        sessions.push(await this.parseCandidate(candidate))
      } catch {
        continue
      }
    }
    return sessions
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

  private async readableRoots(settings: AppSettings): Promise<string[]> {
    const roots = this.roots(settings)
    const readableRoots = []
    for (const root of roots) {
      if (await readable(root)) readableRoots.push(root)
    }
    return readableRoots
  }

  private async fileCandidates(
    roots: string[],
    excludedFolders: string[] = [],
  ): Promise<SessionFileCandidate[]> {
    const filesByRoot = await Promise.all(
      roots.map(async (root) => ({
        root,
        files: await listFiles(root, this.definition.patterns),
      })),
    )
    const exclusions = excludedFolders.map(normalizePathForCompare)

    const candidates: SessionFileCandidate[] = []
    for (const { root, files } of filesByRoot) {
      for (const filePath of files) {
        try {
          if (exclusions.some((excluded) => isInsidePath(filePath, excluded))) continue
          const info = await stat(filePath)
          if (info.size === 0) continue
          if (info.size > 250_000_000) continue

          candidates.push({
            path: filePath,
            root,
            relativePath: path.relative(root, filePath),
            sizeBytes: info.size,
            createdAt: info.birthtime.toISOString(),
            lastUpdated: info.mtime.toISOString(),
            mtimeMs: info.mtimeMs,
          })
        } catch {
          continue
        }
      }
    }

    return candidates
  }

  private async parseCandidate(candidate: SessionFileCandidate): Promise<SessionRecord> {
    const parsed = await parseJsonLike(candidate.path)
    const id = hashId([this.definition.source, candidate.path])
    return {
      id,
      source: this.definition.source,
      title: parsed.title ?? path.basename(candidate.path),
      projectName: projectNameFromPath(parsed.projectPath, candidate.path),
      projectPath: parsed.projectPath,
      branch: parsed.branch,
      storagePath: candidate.path,
      storageKind:
        candidate.path.endsWith('.db') || candidate.path.endsWith('.sqlite') ? 'database' : 'file',
      storageState: 'live',
      createdAt: candidate.createdAt,
      lastUpdated: candidate.lastUpdated,
      messageCount: parsed.messages.length,
      tokens: parsed.tokens,
      sizeBytes: candidate.sizeBytes,
      backupStatus: 'pending',
      tags: [this.definition.source],
      searchText: searchTextFromParsed(parsed),
      metadata: {
        ...parsed.metadata,
        parser: 'generic-json-session-parser',
        root: candidate.root,
        relativePath: candidate.relativePath,
      },
    }
  }
}

export const adapters = definitions.map((definition) => new AgentAdapter(definition))

export function adapterFor(source: AgentSource): AgentAdapter {
  const adapter = adapters.find((item) => item.source === source)
  if (!adapter) throw new Error(`Unsupported agent source: ${source}`)
  return adapter
}
