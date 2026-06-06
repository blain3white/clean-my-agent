export type UsageRange = 7 | 14 | 30 | 'all'
export type UsagePageRange = '7d' | '30d' | '90d' | 'all'

export const usageRanges: Array<{ value: UsageRange; label: string }> = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
]

export const usagePageRanges: Array<{ value: UsagePageRange; label: string }> = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
]
