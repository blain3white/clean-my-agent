import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CleanupCandidate } from '@/shared/types'
import {
  clearCleanupViewState,
  readCleanupViewState,
  writeCleanupViewState,
} from './cleanup-persistence'

const storageKey = 'clean-my-agent.cleanupViewState'

function createLocalStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  }
}

function candidate(id: string): CleanupCandidate {
  return {
    id,
    kind: 'old-session',
    title: id,
    source: 'codex',
    sessionIds: [],
    paths: [],
    sizeBytes: 1,
    reason: 'test',
    risk: 'low',
    recoverable: true,
    backedUp: true,
  }
}

describe('cleanup view state persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorage())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns null for missing, malformed, or wrong-stage storage values', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(readCleanupViewState()).toBeNull()

    globalThis.localStorage.setItem(storageKey, 'not-json')
    expect(readCleanupViewState()).toBeNull()
    expect(errorSpy).toHaveBeenCalledOnce()

    globalThis.localStorage.setItem(storageKey, JSON.stringify({ stage: 'idle' }))
    expect(readCleanupViewState()).toBeNull()
  })

  it('normalizes valid storage values', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))
    globalThis.localStorage.setItem(
      storageKey,
      JSON.stringify({
        stage: 'complete',
        candidateIds: ['a', 1, 'b', null],
      }),
    )

    expect(readCleanupViewState()).toEqual({
      stage: 'complete',
      savedAt: '2026-06-06T12:00:00.000Z',
      candidateIds: ['a', 'b'],
    })
  })

  it('writes and clears candidate ids', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))

    writeCleanupViewState([candidate('c1'), candidate('c2')])

    expect(JSON.parse(globalThis.localStorage.getItem(storageKey) ?? '{}')).toEqual({
      stage: 'complete',
      savedAt: '2026-06-06T12:00:00.000Z',
      candidateIds: ['c1', 'c2'],
    })
    expect(readCleanupViewState()?.candidateIds).toEqual(['c1', 'c2'])

    clearCleanupViewState()
    expect(readCleanupViewState()).toBeNull()
  })

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)

    expect(readCleanupViewState()).toBeNull()
    expect(() => writeCleanupViewState([candidate('c1')])).not.toThrow()
    expect(() => clearCleanupViewState()).not.toThrow()
  })

  it('swallows localStorage write and clear failures', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded')
      }),
      removeItem: vi.fn(() => {
        throw new Error('storage locked')
      }),
    })

    expect(() => writeCleanupViewState([candidate('c1')])).not.toThrow()
    expect(() => clearCleanupViewState()).not.toThrow()
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })
})
