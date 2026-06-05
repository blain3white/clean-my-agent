import type { SessionRecord } from '@/shared/types'
import { dateKeyFromTime } from '@/lib/date-key'

export function sessionDateTokenEntries(session: SessionRecord): Array<[string, number]> {
  const usageByDate = session.metadata.usageByDate
  if (usageByDate && typeof usageByDate === 'object' && !Array.isArray(usageByDate)) {
    const entries = Object.entries(usageByDate).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    )
    if (entries.length > 0) return entries
  }

  return [[dateKeyFromTime(new Date(session.lastUpdated).getTime()), session.tokens.total]]
}

export function sessionTokenTotalForDates(sessions: SessionRecord[], dates: Set<string>): number {
  return sessions.reduce((total, session) => {
    return (
      total +
      sessionDateTokenEntries(session).reduce(
        (sum, [date, tokens]) => sum + (dates.has(date) ? tokens : 0),
        0,
      )
    )
  }, 0)
}
