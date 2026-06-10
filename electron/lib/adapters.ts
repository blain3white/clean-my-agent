import path from 'node:path'
import { constants, createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type {
  AgentScanDiagnostic,
  AgentInstallState,
  AgentSource,
  AppSettings,
  SessionRecord,
  TokenCostSource,
  TokenUsage,
  UniversalRelayDocument,
  UniversalRelayMessage,
} from '../../src/shared/types'
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
import { rootsForPlatform, scannerProviders } from './scanner-providers'
import type {
  AgentScannerProvider,
  ScannerProviderCandidate,
  ScannerProviderParsedSession,
} from './scanner-providers'

type ParsedSession = ScannerProviderParsedSession

type SessionFileCandidate = ScannerProviderCandidate

type CandidateDiscovery = {
  candidates: SessionFileCandidate[]
  diagnostics: AgentScanDiagnostic[]
  skippedFiles: number
}

type RelayHints = Pick<ParsedSession, 'files' | 'commands' | 'attachments' | 'gitDiff'>

type SqliteStatement = {
  all: (...values: unknown[]) => JsonRecord[]
}

type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

type SqliteModule = {
  DatabaseSync: new (filePath: string, options?: { readOnly?: boolean }) => SqliteDatabase
}

const maxDiagnosticsPerScan = 50
const maxRelayItems = 500
const maxRelayDiffLength = 200_000
const sqliteJsonValueColumns = ['value', 'json', 'data', 'body', 'content', 'contents']
const sqliteKeyColumns = ['key', 'id', 'name']

const emptyTokens = (): TokenUsage => ({
  input: 0,
  output: 0,
  cached: 0,
  cacheCreation: 0,
  cacheRead: 0,
  total: 0,
  estimated: true,
})

function normalizePathForCompare(value: string): string {
  return path.resolve(expandHome(value)).replace(/[\\/]+$/, '')
}

function isInsidePath(filePath: string, parentPath: string): boolean {
  const file = normalizePathForCompare(filePath)
  const parent = normalizePathForCompare(parentPath)
  return file === parent || file.startsWith(`${parent}${path.sep}`)
}

export function enabledProviderSources(settings: AppSettings): AgentSource[] {
  return scannerProviders
    .map((provider) => provider.source)
    .filter((source) => settings.enabledProviders[source] !== false)
}

function pushDiagnostic(diagnostics: AgentScanDiagnostic[], diagnostic: AgentScanDiagnostic): void {
  if (diagnostics.length < maxDiagnosticsPerScan) {
    diagnostics.push(diagnostic)
    return
  }

  const overflow = diagnostics.find((item) => item.code === 'diagnostic-overflow')
  if (overflow) {
    overflow.count = (overflow.count ?? 0) + 1
    return
  }

  diagnostics.push({
    level: 'info',
    code: 'diagnostic-overflow',
    message: 'Additional scan diagnostics were suppressed.',
    count: 1,
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error'
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

async function rootAccess(
  root: string,
): Promise<{ root: string; exists: boolean; readable: boolean }> {
  try {
    await access(root, constants.R_OK)
    return { root, exists: true, readable: true }
  } catch (readError) {
    try {
      await access(root, constants.F_OK)
      return { root, exists: true, readable: false }
    } catch (existsError) {
      const code = errorCode(existsError) ?? errorCode(readError)
      return { root, exists: code === 'EACCES' || code === 'EPERM', readable: false }
    }
  }
}

function isLikelyPath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 4096 || trimmed.includes('\0')) return false
  if (/^(https?|data|blob):/i.test(trimmed)) return false
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  )
}

function mediaTypeFromPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.json') return 'application/json'
  if (extension === '.md') return 'text/markdown'
  if (extension === '.txt' || extension === '.log') return 'text/plain'
  return undefined
}

function createRelayHints(): RelayHints {
  return {
    files: [],
    commands: [],
    attachments: [],
  }
}

function addRelayFile(
  hints: RelayHints,
  filePath: string | undefined,
  reason: string,
  lastSeenAt?: string,
): void {
  if (!filePath || !isLikelyPath(filePath)) return
  if (hints.files.some((item) => item.path === filePath)) return
  if (hints.files.length >= maxRelayItems) return
  hints.files.push({ path: filePath, reason, lastSeenAt })
}

function addRelayCommand(
  hints: RelayHints,
  command: string | undefined,
  cwd?: string,
  createdAt?: string,
): void {
  const normalized = command?.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > 4096) return
  if (hints.commands.some((item) => item.command === normalized && item.cwd === cwd)) return
  if (hints.commands.length >= maxRelayItems) return
  hints.commands.push({ command: normalized, cwd, createdAt })
}

function addRelayAttachment(
  hints: RelayHints,
  filePath: string | undefined,
  mediaType?: string,
  sizeBytes?: number,
): void {
  if (!filePath || !isLikelyPath(filePath)) return
  if (hints.attachments.some((item) => item.path === filePath)) return
  if (hints.attachments.length >= maxRelayItems) return
  hints.attachments.push({
    path: filePath,
    mediaType: mediaType ?? mediaTypeFromPath(filePath),
    sizeBytes,
  })
}

function cleanGitDiffPath(filePath: string): string | undefined {
  const normalized = filePath
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^(a|b)\//, '')
  if (!normalized || normalized === '/dev/null') return undefined
  return normalized
}

function gitChangedFilesFromDiff(diff: string | undefined): string[] {
  if (!diff) return []

  const files = new Set<string>()
  for (const line of diff.split(/\r?\n/)) {
    const diffHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (diffHeader) {
      const nextPath = cleanGitDiffPath(diffHeader[2])
      if (nextPath) files.add(nextPath)
      if (files.size >= maxRelayItems) break
      continue
    }

    const fileHeader = /^(?:\+\+\+|---)\s+(.+)$/.exec(line)
    if (!fileHeader) continue
    const filePath = cleanGitDiffPath(fileHeader[1])
    if (filePath) files.add(filePath)
    if (files.size >= maxRelayItems) break
  }

  return Array.from(files)
}

function isSensitiveRelayPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  const basename = normalized.split('/').filter(Boolean).pop() ?? normalized
  if (basename === '.env' || basename.startsWith('.env.')) return true
  if (normalized.includes('/.ssh/') || normalized.includes('/keychain/')) return true
  return /(^|[._/-])(token|tokens|secret|secrets|credential|credentials|oauth|api[-_]?key|apikey|private[-_]?key|password|passwd)([._/-]|$)/i.test(
    normalized,
  )
}

function redactRelayCommand(command: string): string {
  return command
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|PASS|PRIVATE_KEY)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi,
      '$1=[redacted]',
    )
    .replace(
      /(--?(?:token|secret|api-key|apikey|password|pass|private-key|key))(\s+|=)("[^"]*"|'[^']*'|\S+)/gi,
      '$1$2[redacted]',
    )
}

function timestampFromRecord(record: JsonRecord): string | undefined {
  const payload = toRecord(record.payload)
  const message = toRecord(record.message)
  return (
    asString(record.timestamp) ??
    asString(record.created_at) ??
    asString(record.createdAt) ??
    asString(message?.timestamp) ??
    asString(message?.created_at) ??
    asString(message?.createdAt) ??
    asString(payload?.timestamp) ??
    asString(payload?.created_at) ??
    asString(payload?.createdAt)
  )
}

function extractRelayHints(
  value: unknown,
  hints: RelayHints,
  inherited?: { cwd?: string; createdAt?: string },
  depth = 0,
): void {
  if (depth > 7) return
  if (Array.isArray(value)) {
    value.forEach((item) => extractRelayHints(item, hints, inherited, depth + 1))
    return
  }

  const record = toRecord(value)
  if (!record) return

  const cwd =
    asString(record.cwd) ??
    asString(record.projectPath) ??
    asString(record.project_path) ??
    inherited?.cwd
  const createdAt = timestampFromRecord(record) ?? inherited?.createdAt
  const command =
    asString(record.command) ??
    asString(record.cmd) ??
    asString(record.shell_command) ??
    asString(record.shellCommand) ??
    asString(record.terminalCommand)
  addRelayCommand(hints, command, cwd, createdAt)

  const diff = asString(record.diff) ?? asString(record.gitDiff) ?? asString(record.patch)
  if (diff && !hints.gitDiff && /\bdiff --git\b|^@@\s|^\+\+\+ /m.test(diff)) {
    hints.gitDiff = diff.slice(0, maxRelayDiffLength)
  }

  const pathKeys = ['path', 'file', 'filePath', 'file_path', 'filename', 'workspaceFile', 'uri']
  pathKeys.forEach((key) => {
    const filePath = asString(record[key])
    addRelayFile(hints, filePath, `Referenced by ${key}`, createdAt)
  })

  const attachmentValues = [record.attachments, record.attachment]
  attachmentValues.forEach((attachments) => {
    if (!Array.isArray(attachments)) {
      const attachmentPath = asString(attachments)
      addRelayAttachment(hints, attachmentPath)
      return
    }

    attachments.forEach((attachment) => {
      const attachmentRecord = toRecord(attachment)
      if (!attachmentRecord) {
        addRelayAttachment(hints, asString(attachment))
        return
      }
      const attachmentPath =
        asString(attachmentRecord.path) ??
        asString(attachmentRecord.filePath) ??
        asString(attachmentRecord.file_path) ??
        asString(attachmentRecord.filename)
      addRelayAttachment(
        hints,
        attachmentPath,
        asString(attachmentRecord.mediaType) ?? asString(attachmentRecord.mimeType),
        optionalNumberFromRecord(attachmentRecord, ['sizeBytes', 'size_bytes', 'size']),
      )
    })
  })

  Object.entries(record).forEach(([key, child]) => {
    if (key === 'raw') return
    if (key === 'files' && Array.isArray(child)) {
      child.forEach((item) => {
        const itemRecord = toRecord(item)
        if (!itemRecord) {
          addRelayFile(hints, asString(item), 'Listed in files', createdAt)
          return
        }
        const filePath =
          asString(itemRecord.path) ??
          asString(itemRecord.filePath) ??
          asString(itemRecord.file_path) ??
          asString(itemRecord.filename)
        addRelayFile(hints, filePath, 'Listed in files', createdAt)
      })
    }
    extractRelayHints(child, hints, { cwd, createdAt }, depth + 1)
  })
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

function isLikelyMessageItem(value: unknown): boolean {
  return extractMessage(value, '__probe__') !== undefined
}

function collectMessageItems(
  value: unknown,
  items: unknown[] = [],
  seen = new WeakSet<object>(),
  depth = 0,
): unknown[] {
  if (depth > 7) return items

  if (Array.isArray(value)) {
    if (seen.has(value)) return items
    seen.add(value)
    const messageItems = value.filter(isLikelyMessageItem)
    if (messageItems.length > 0) {
      items.push(...messageItems)
      return items
    }
    value.forEach((item) => collectMessageItems(item, items, seen, depth + 1))
    return items
  }

  const record = toRecord(value)
  if (!record) return items
  if (seen.has(record)) return items
  seen.add(record)

  if (isLikelyMessageItem(record)) {
    items.push(record)
    return items
  }

  Object.entries(record).forEach(([key, child]) => {
    if (key === 'raw') return
    collectMessageItems(child, items, seen, depth + 1)
  })
  return items
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
  const timestamp = timestampFromRecord(record)

  if (!timestamp) return undefined
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

function timestampFromUsageRecord(record: JsonRecord): string | undefined {
  const timestamp = timestampFromRecord(record)
  if (!timestamp) return undefined

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
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

function captureCodexSessionMetadata(record: JsonRecord, metadata: JsonRecord): void {
  if (record.type !== 'session_meta') return
  const payload = toRecord(record.payload)
  if (!payload) return

  metadata.codexThreadId ??= asString(payload.id)
  metadata.codexThreadSource ??= asString(payload.thread_source)
  metadata.codexForkedFromId ??= asString(payload.forked_from_id) ?? asString(payload.forkedFromId)
  metadata.codexParentThreadId ??=
    asString(payload.parent_thread_id) ?? asString(payload.parentThreadId)
  metadata.codexAgentNickname ??= asString(payload.agent_nickname)
}

function extractUsage(
  value: unknown,
  seenUsageIds = new Set<string>(),
  fallbackModel?: string,
): TokenUsage {
  const tokens = emptyTokens()
  const seenUsageObjects = new WeakSet<JsonRecord>()
  const seenVisitObjects = new WeakSet<object>()

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
    if (depth > 7) return
    if (Array.isArray(node)) {
      if (seenVisitObjects.has(node)) return
      seenVisitObjects.add(node)
      node.forEach((item) => visit(item, depth + 1))
      return
    }

    const record = toRecord(node)
    if (!record) return
    if (seenVisitObjects.has(record)) return
    seenVisitObjects.add(record)

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

    Object.entries(record).forEach(([key, child]) => {
      if (key === 'raw') return
      visit(child, depth + 1)
    })
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

function isSqliteLikePath(filePath: string): boolean {
  return /\.(db|sqlite|vscdb)$/i.test(filePath)
}

function storageKindFromPath(filePath: string): SessionRecord['storageKind'] {
  return isSqliteLikePath(filePath) ? 'database' : 'file'
}

function addTextFallbackMessages(text: string, messages: UniversalRelayMessage[]): void {
  text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 200)
    .forEach((line, index) => {
      messages.push({ id: `${index}`, role: 'unknown', text: line.slice(0, 1000) })
    })
}

function parseEmbeddedJson(value: string): unknown | undefined {
  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

function textFromSqliteCell(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return undefined
}

function valueFromSqliteCell(value: unknown): unknown {
  const text = textFromSqliteCell(value)
  if (text === undefined) return value
  return parseEmbeddedJson(text) ?? text
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

async function readSqliteJsonValues(
  filePath: string,
): Promise<{ sourceFormat: string; values: unknown[] } | undefined> {
  let db: SqliteDatabase | undefined
  try {
    const sqlite = (await import('node:sqlite')) as unknown as SqliteModule
    db = new sqlite.DatabaseSync(filePath, { readOnly: true })
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => asString(row.name))
      .filter((name): name is string => Boolean(name && !name.startsWith('sqlite_')))

    const values: unknown[] = []
    for (const table of tables.slice(0, 40)) {
      const quotedTable = quoteSqlIdentifier(table)
      const columns = db
        .prepare(`PRAGMA table_info(${quotedTable})`)
        .all()
        .map((row) => asString(row.name))
        .filter((name): name is string => Boolean(name))
      const valueColumns = sqliteJsonValueColumns.filter((column) => columns.includes(column))
      if (valueColumns.length === 0) continue
      const keyColumn = sqliteKeyColumns.find((column) => columns.includes(column))
      const selectedColumns = [...(keyColumn ? [keyColumn] : []), ...valueColumns]

      const rows = db
        .prepare(
          `SELECT ${selectedColumns.map(quoteSqlIdentifier).join(', ')} FROM ${quotedTable} LIMIT 1000`,
        )
        .all()

      rows.forEach((row) => {
        const key = keyColumn ? asString(row[keyColumn]) : undefined
        valueColumns.forEach((column) => {
          const value = valueFromSqliteCell(row[column])
          if (value === undefined || value === '') return
          values.push(key ? { table, key, value } : value)
        })
      })
    }

    if (values.length === 0) return undefined
    const sourceFormat =
      path.basename(filePath).toLowerCase() === 'state.vscdb' ||
      tables.includes('ItemTable') ||
      tables.includes('cursorDiskKV')
        ? 'cursor-state-sqlite'
        : 'sqlite-kv-json'
    return { sourceFormat, values }
  } catch {
    return undefined
  } finally {
    db?.close()
  }
}

async function parseJsonLike(filePath: string): Promise<ParsedSession> {
  const messages: UniversalRelayMessage[] = []
  const metadata: JsonRecord = {}
  const relayHints = createRelayHints()
  const usageByDate: Record<string, number> = {}
  const usageEvents: Array<{ timestamp: string; tokens: number }> = []
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
        if (record && metadata.sourceFormat === 'codex-jsonl') {
          captureCodexSessionMetadata(record, metadata)
        }
        currentModel = record ? (modelHintFromRecord(record) ?? currentModel) : currentModel
        const usage = extractUsage(json, seenUsageIds, currentModel)
        addTokens(tokens, usage)
        extractRelayHints(json, relayHints)
        const dateKey = record ? dateKeyFromRecord(record) : undefined
        if (dateKey && usage.total > 0)
          usageByDate[dateKey] = (usageByDate[dateKey] ?? 0) + usage.total
        const usageTimestamp = record ? timestampFromUsageRecord(record) : undefined
        if (usageTimestamp && usage.total > 0) {
          usageEvents.push({ timestamp: usageTimestamp, tokens: usage.total })
        }
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
      extractRelayHints(json, relayHints)
      collectMessageItems(json)
        .slice(0, 3000)
        .forEach((item, index) => {
          const message = extractMessage(item, `${index}`)
          if (message) messages.push(message)
        })
      tokens = extractUsage(json, new Set<string>(), currentModel)
    } catch {
      messages.push({ id: 'raw', role: 'unknown', text: text.slice(0, 4000) })
    }
  } else if (isSqliteLikePath(filePath)) {
    const sqlite = await readSqliteJsonValues(filePath)
    if (sqlite) {
      sampleForHints = sqlite.values
      metadata.sourceFormat = sqlite.sourceFormat
      extractRelayHints(sqlite.values, relayHints)
      collectMessageItems(sqlite.values)
        .slice(0, 3000)
        .forEach((item, index) => {
          const message = extractMessage(item, `${index}`)
          if (message) messages.push(message)
        })
      tokens = extractUsage(sqlite.values, new Set<string>(), currentModel)
    } else {
      addTextFallbackMessages(await safeReadText(filePath), messages)
    }
  } else {
    addTextFallbackMessages(await safeReadText(filePath), messages)
  }

  return {
    title: firstTitle(messages, path.basename(filePath)),
    projectPath: findStringByKeys(sampleForHints, [
      'cwd',
      'projectPath',
      'project_path',
      'workspace',
      'workspacePath',
      'folder',
    ]),
    branch: findStringByKeys(sampleForHints, ['branch', 'gitBranch', 'git_branch']),
    messages,
    files: relayHints.files,
    commands: relayHints.commands,
    attachments: relayHints.attachments,
    gitDiff: relayHints.gitDiff,
    tokens,
    usageByDate,
    usageEvents,
    metadata: {
      ...metadata,
      usageByDate,
      usageEvents,
      costSource: tokens.costSource,
      model: tokens.model,
    },
  }
}

export class AgentAdapter {
  private readonly provider: AgentScannerProvider

  constructor(provider: AgentScannerProvider) {
    this.provider = provider
  }

  get source(): AgentSource {
    return this.provider.source
  }

  get name(): string {
    return this.provider.name
  }

  roots(settings: AppSettings): string[] {
    const configured = settings.scanRoots[this.provider.source]
    return (configured?.length ? configured : rootsForPlatform(this.provider)).map(expandHome)
  }

  async recentCandidates(settings: AppSettings, limit: number): Promise<SessionFileCandidate[]> {
    const roots = await this.readableRoots(settings)
    const { candidates } = await this.fileCandidates(roots, settings.excludedFolders)
    return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
  }

  async scan(
    settings: AppSettings,
  ): Promise<{ state: AgentInstallState; sessions: SessionRecord[] }> {
    const roots = this.roots(settings)
    const rootChecks = await Promise.all(roots.map(rootAccess))
    const readableRoots = rootChecks.filter((item) => item.readable).map((item) => item.root)
    const diagnostics: AgentScanDiagnostic[] = []
    rootChecks
      .filter((item) => !item.readable)
      .forEach((item) => {
        if (!item.exists) {
          if (readableRoots.length === 0) {
            pushDiagnostic(diagnostics, {
              level: 'info',
              code: 'root-missing',
              message: 'Scan root does not exist.',
              path: item.root,
            })
          }
          return
        }

        pushDiagnostic(diagnostics, {
          level: 'warning',
          code: 'root-permission-blocked',
          message: 'Scan root exists but is not readable. Grant folder access and scan again.',
          path: item.root,
        })
      })
    const discovery = await this.fileCandidates(readableRoots, settings.excludedFolders)
    diagnostics.push(...discovery.diagnostics)
    const files = discovery.candidates

    const sessions: SessionRecord[] = []
    let skippedFiles = discovery.skippedFiles
    for (const candidate of files) {
      try {
        sessions.push(await this.parseCandidate(candidate))
      } catch (error) {
        skippedFiles += 1
        pushDiagnostic(diagnostics, {
          level: 'warning',
          code: 'parse-failed',
          message: `Could not parse session file: ${errorMessage(error)}`,
          path: candidate.path,
        })
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
        source: this.provider.source,
        name: this.provider.name,
        installed: readableRoots.length > 0,
        readable: readableRoots.length > 0,
        rootPaths: roots,
        sessionCount: sessions.length,
        sizeBytes,
        scannedFiles: files.length,
        skippedFiles,
        lastScannedAt: new Date().toISOString(),
        note: this.provider.note,
        diagnostics,
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
    const parsed = await this.parseSessionFile(session.storagePath)
    return {
      schema: 'clean-my-agent.universal-session.v1',
      exportedAt: new Date().toISOString(),
      source: session.source,
      session,
      messages: parsed.messages,
      files: parsed.files,
      commands: parsed.commands,
      git: {
        branch: session.branch,
        projectPath: session.projectPath,
        diff: parsed.gitDiff,
      },
      attachments: parsed.attachments,
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
  ): Promise<CandidateDiscovery> {
    const filesByRoot = await Promise.all(
      roots.map(async (root) => ({
        root,
        files: await listFiles(root, this.provider.patterns),
      })),
    )
    const exclusions = excludedFolders.map(normalizePathForCompare)

    const candidates: SessionFileCandidate[] = []
    const diagnostics: AgentScanDiagnostic[] = []
    let skippedFiles = 0
    for (const { root, files } of filesByRoot) {
      for (const filePath of files) {
        try {
          if (exclusions.some((excluded) => isInsidePath(filePath, excluded))) continue
          const info = await stat(filePath)
          if (info.size === 0) {
            skippedFiles += 1
            pushDiagnostic(diagnostics, {
              level: 'info',
              code: 'empty-file-skipped',
              message: 'Skipped an empty session file.',
              path: filePath,
            })
            continue
          }
          if (info.size > 250_000_000) {
            skippedFiles += 1
            pushDiagnostic(diagnostics, {
              level: 'warning',
              code: 'oversized-file-skipped',
              message: 'Skipped a session file larger than 250 MB.',
              path: filePath,
            })
            continue
          }

          candidates.push({
            path: filePath,
            root,
            relativePath: path.relative(root, filePath),
            sizeBytes: info.size,
            createdAt: info.birthtime.toISOString(),
            lastUpdated: info.mtime.toISOString(),
            mtimeMs: info.mtimeMs,
          })
        } catch (error) {
          skippedFiles += 1
          pushDiagnostic(diagnostics, {
            level: 'warning',
            code: 'candidate-stat-failed',
            message: `Could not inspect session file: ${errorMessage(error)}`,
            path: filePath,
          })
          continue
        }
      }
    }

    return { candidates, diagnostics, skippedFiles }
  }

  private async parseCandidate(candidate: SessionFileCandidate): Promise<SessionRecord> {
    const parsed = await this.parseSessionFile(candidate.path)
    const id = hashId([this.provider.source, candidate.path])
    return {
      id,
      source: this.provider.source,
      title: parsed.title ?? path.basename(candidate.path),
      projectName: projectNameFromPath(parsed.projectPath, candidate.path),
      projectPath: parsed.projectPath,
      branch: parsed.branch,
      storagePath: candidate.path,
      storageKind: storageKindFromPath(candidate.path),
      storageState: 'live',
      createdAt: candidate.createdAt,
      lastUpdated: candidate.lastUpdated,
      messageCount: parsed.messages.length,
      tokens: parsed.tokens,
      sizeBytes: candidate.sizeBytes,
      backupStatus: 'pending',
      tags: [this.provider.source],
      searchText: searchTextFromParsed(parsed),
      metadata: {
        ...parsed.metadata,
        parser: this.provider.parserName ?? 'generic-json-session-parser',
        root: candidate.root,
        relativePath: candidate.relativePath,
        relayFiles: parsed.files.filter((item) => !isSensitiveRelayPath(item.path)),
        relayCommands: parsed.commands.map((item) => ({
          ...item,
          command: redactRelayCommand(item.command),
        })),
        gitChangedFiles: gitChangedFilesFromDiff(parsed.gitDiff).filter(
          (item) => !isSensitiveRelayPath(item),
        ),
      },
    }
  }

  private async parseSessionFile(filePath: string): Promise<ParsedSession> {
    return this.provider.parseSession
      ? this.provider.parseSession(filePath)
      : parseJsonLike(filePath)
  }
}

export const adapters = scannerProviders.map((provider) => new AgentAdapter(provider))

export function adapterFor(source: AgentSource): AgentAdapter {
  const adapter = adapters.find((item) => item.source === source)
  if (!adapter) throw new Error(`Unsupported agent source: ${source}`)
  return adapter
}
