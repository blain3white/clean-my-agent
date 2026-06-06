import { describe, expect, it } from 'vitest'
import { usagePageRanges, usageRanges } from './ranges'

describe('usage range constants', () => {
  it('keeps overview range options in ascending order', () => {
    expect(usageRanges).toEqual([
      { value: 7, label: '7d' },
      { value: 14, label: '14d' },
      { value: 30, label: '30d' },
    ])
  })

  it('keeps usage page ranges in the expected tab order', () => {
    expect(usagePageRanges.map((range) => range.value)).toEqual(['7d', '30d', '90d', 'all'])
    expect(usagePageRanges.at(-1)?.label).toBe('All')
  })
})
