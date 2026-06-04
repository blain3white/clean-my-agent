import { describe, expect, it } from 'vitest'
import {
  asString,
  isClaudeJsonlRecord,
  isCodexJsonlRecord,
  isCursorWorkspaceRecord,
  isOpenCodeStorageRecord,
  isRecord,
  toRecord,
} from './agent-storage-formats'

describe('agent storage format guards', () => {
  it('recognizes plain records but rejects arrays and null values', () => {
    expect(isRecord({ value: true })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })

  it('narrows known agent storage records', () => {
    expect(isCodexJsonlRecord({ type: 'response_item', payload: {} })).toBe(true)
    expect(isClaudeJsonlRecord({ sessionId: 'claude-session' })).toBe(true)
    expect(isOpenCodeStorageRecord({ sessionID: 'opencode-session' })).toBe(true)
    expect(isCursorWorkspaceRecord({ workspace: '/tmp/project' })).toBe(true)
  })

  it('keeps helper conversions intentionally conservative', () => {
    expect(asString('hello')).toBe('hello')
    expect(asString(42)).toBe('42')
    expect(asString(true)).toBeUndefined()
    expect(toRecord({ ok: true })).toEqual({ ok: true })
    expect(toRecord(['not', 'a', 'record'])).toBeUndefined()
  })
})
