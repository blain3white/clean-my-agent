import type { SessionRecord } from '@/shared/types'
import { dateKeyFromTime } from '@/lib/date-key'

function usageEventsEntries(
  session: SessionRecord,
  timezone: string,
): Array<[string, number]> | undefined {
  const usageEvents = session.metadata.usageEvents
  if (!Array.isArray(usageEvents)) return undefined

  const byDate = new Map<string, number>()
  usageEvents.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const record = item as Record<string, unknown>
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : undefined
    const tokens =
      typeof record.tokens === 'number' && Number.isFinite(record.tokens) ? record.tokens : 0
    if (!timestamp || tokens <= 0) return

    const time = new Date(timestamp).getTime()
    if (Number.isNaN(time)) return
    const date = dateKeyFromTime(time, timezone)
    byDate.set(date, (byDate.get(date) ?? 0) + tokens)
  })

  return byDate.size > 0 ? Array.from(byDate.entries()) : undefined
}

export function sessionDateTokenEntries(
  session: SessionRecord,
  timezone = 'UTC',
): Array<[string, number]> {
  const usageEvents = usageEventsEntries(session, timezone)
  if (usageEvents) return usageEvents

  const usageByDate = session.metadata.usageByDate
  if (usageByDate && typeof usageByDate === 'object' && !Array.isArray(usageByDate)) {
    const entries = Object.entries(usageByDate).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    )
    if (entries.length > 0) return entries
  }

  return [
    [dateKeyFromTime(new Date(session.lastUpdated).getTime(), timezone), session.tokens.total],
  ]
}

export function sessionTokenTotalForDates(
  sessions: SessionRecord[],
  dates: Set<string>,
  timezone = 'UTC',
): number {
  return sessions.reduce((total, session) => {
    return (
      total +
      sessionDateTokenEntries(session, timezone).reduce(
        (sum, [date, tokens]) => sum + (dates.has(date) ? tokens : 0),
        0,
      )
    )
  }, 0)
}
