import type { TrashRecord } from '@/shared/types'

export const usageTimezoneOptions = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
]

export function usageTimezoneSelectOptions(currentTimezone: string) {
  return Array.from(new Set([currentTimezone, ...usageTimezoneOptions])).map((timezone) => ({
    value: timezone,
    label: timezone,
  }))
}

export function trashPrimaryPath(record: TrashRecord): string {
  return record.originalPaths[0] ?? record.trashPath
}
