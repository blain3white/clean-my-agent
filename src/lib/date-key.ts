export function dateKeyFromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}
