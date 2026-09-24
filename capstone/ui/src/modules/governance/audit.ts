/**
 * Audit page helpers (it5 T-5-2 — R-UI-AUD-1). The backend audit DTO parses
 * `from`/`to` with zod `.datetime({offset:true})` — a full ISO-8601 datetime
 * with offset. `<input type="date">` produces `YYYY-MM-DD`, so the UI
 * converts to the day-bounds datetimes the backend accepts.
 */
export interface AuditDateRange {
  from?: string | undefined
  to?: string | undefined
}

/** '2026-01-07' → from '2026-01-07T00:00:00.000Z', to '2026-01-07T23:59:59.999Z'. */
export function auditDateRangeToIso(from: string, to: string): AuditDateRange {
  const range: AuditDateRange = {}
  if (from.trim() !== '') range.from = `${from.trim()}T00:00:00.000Z`
  if (to.trim() !== '') range.to = `${to.trim()}T23:59:59.999Z`
  return range
}