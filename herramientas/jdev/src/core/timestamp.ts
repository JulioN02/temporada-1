import { TimestampError } from './errors.ts'

/** Current Unix epoch in whole seconds (injectable clock for tests). */
export function epochSeconds(now: () => number = Date.now): number {
  return Math.floor(now() / 1000)
}

/** Current Unix epoch in milliseconds (injectable clock for tests). */
export function epochMillis(now: () => number = Date.now): number {
  return now()
}

/** Millisecond instant -> ISO 8601 UTC with milliseconds (Z suffix). */
export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Millisecond instant -> ISO 8601 with numeric local offset (e.g. -03:00).
 * `getTimezoneOffset()` returns UTC − local in minutes (positive WEST of UTC),
 * so the local offset is its negation; shifting by that offset yields the
 * local wall-clock, then the Z is replaced by the numeric offset.
 */
export function toIsoLocal(ms: number): string {
  const offsetMin = -new Date(ms).getTimezoneOffset() // e.g. -180 for UTC-3 (sign inversion gotcha)
  const wall = new Date(ms + offsetMin * 60_000)
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${wall.toISOString().replace('Z', '')}${sign}${hh}:${mm}`
}

/** Strict numeric epoch parse: non-negative integer digits only, else TimestampError (exit 2). */
export function parseEpoch(arg: string): number {
  if (!/^\d+$/.test(arg)) {
    throw new TimestampError(`invalid epoch '${arg}' (expected a non-negative integer)`)
  }
  return Number(arg)
}