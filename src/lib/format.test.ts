import { describe, expect, it, vi } from 'vitest'
import { formatBytes, formatCost, formatRelative, formatTokens } from './format'

describe('formatBytes', () => {
  it('formats zero, invalid, and common byte units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
  })
})

describe('formatTokens', () => {
  it('uses compact token suffixes', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_200)).toBe('1.2K')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})

describe('formatRelative', () => {
  it('formats recent timestamps relative to now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'))

    expect(formatRelative()).toBe('Never')
    expect(formatRelative('not-a-date')).toBe('Unknown')
    expect(formatRelative('2026-06-04T11:59:45.000Z')).toBe('Just now')
    expect(formatRelative('2026-06-04T11:45:00.000Z')).toBe('15m ago')
    expect(formatRelative('2026-06-04T09:00:00.000Z')).toBe('3h ago')
    expect(formatRelative('2026-06-02T12:00:00.000Z')).toBe('2d ago')

    vi.useRealTimers()
  })
})

describe('cost formatting', () => {
  it('formats exact dollar costs', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.001)).toBe('<$0.01')
    expect(formatCost(1.234)).toBe('$1.23')
  })
})
