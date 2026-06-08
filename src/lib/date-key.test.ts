import { describe, expect, it } from 'vitest'
import { dateKeyFromTime } from './date-key'

describe('dateKeyFromTime', () => {
  it('extracts the UTC ISO date key', () => {
    expect(dateKeyFromTime(new Date('2026-06-06T23:59:59.999Z').getTime())).toBe('2026-06-06')
  })

  it('handles the Unix epoch', () => {
    expect(dateKeyFromTime(0)).toBe('1970-01-01')
  })
})
