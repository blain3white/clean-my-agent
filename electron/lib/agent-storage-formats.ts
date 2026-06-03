import type { UniversalRelayMessage } from '../../src/shared/types'

export type JsonRecord = Record<string, unknown>

export type TokenUsageLike = {
  input_tokens?: number
  prompt_tokens?: number
  promptTokens?: number
  inputTokens?: number
  output_tokens?: number
  completion_tokens?: number
  completionTokens?: number
  outputTokens?: number
  cached_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cachedTokens?: number
  cacheTokens?: number
  total_tokens?: number
  totalTokens?: number
}

export type ContentBlock = {
  type?: string
  text?: string
  content?: string
  value?: string
  input?: string
}

export type CodexJsonlRecord =
  | {
      type: 'session_meta'
      timestamp?: string
      payload?: {
        id?: string
        timestamp?: string
        cwd?: string
        source?: string
        model_provider?: string
        git?: { branch?: string; commit_hash?: string }
      }
    }
  | {
      type: 'response_item'
      timestamp?: string
      payload?: {
        id?: string
        role?: UniversalRelayMessage['role']
        type?: string
        content?: string | ContentBlock[]
        usage?: TokenUsageLike
      }
    }
  | {
      type: 'event_msg' | 'turn_context'
      timestamp?: string
      payload?: JsonRecord
    }

export type ClaudeJsonlRecord = {
  type?: 'user' | 'assistant' | 'system' | 'attachment' | 'queue-operation' | 'last-prompt' | string
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  cwd?: string
  sessionId?: string
  gitBranch?: string
  content?: string | ContentBlock[]
  message?: {
    id?: string
    role?: UniversalRelayMessage['role']
    content?: string | ContentBlock[]
    usage?: TokenUsageLike
  }
}

export type OpenCodeStorageRecord = {
  sessionID?: string
  updatedAt?: number
  agentUsed?: boolean
  reminderCount?: number
  injectedPaths?: string[]
}

export type CursorWorkspaceRecord = {
  folder?: string
  workspace?: string
}

export type CursorStateItem = {
  key: string
  value: string
}

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isCodexJsonlRecord(value: unknown): value is CodexJsonlRecord {
  return isRecord(value) && typeof value.type === 'string' && ('payload' in value || 'timestamp' in value)
}

export function isClaudeJsonlRecord(value: unknown): value is ClaudeJsonlRecord {
  return isRecord(value) && (typeof value.type === 'string' || 'message' in value || 'sessionId' in value)
}

export function isOpenCodeStorageRecord(value: unknown): value is OpenCodeStorageRecord {
  return isRecord(value) && (typeof value.sessionID === 'string' || 'updatedAt' in value)
}

export function isCursorWorkspaceRecord(value: unknown): value is CursorWorkspaceRecord {
  return isRecord(value) && (typeof value.folder === 'string' || typeof value.workspace === 'string')
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

export function toRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}
