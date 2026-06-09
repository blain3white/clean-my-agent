const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterForTimezone(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatterCache.set(timezone, formatter)
  return formatter
}

export function dateKeyFromTime(time: number, timezone = 'UTC'): string {
  const date = new Date(time)
  try {
    return formatterForTimezone(timezone).format(date)
  } catch {
    return formatterForTimezone('UTC').format(date)
  }
}
