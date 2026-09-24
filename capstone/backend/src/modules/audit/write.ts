import type { Db } from '../../db/pool.ts'

/**
 * Audit write helper (F-7, S1 — early port of the audit module; the read API
 * stays in it6).
 *
 * Two write paths:
 * - `writeAudit`: SAME-transaction helper — called from domain services inside
 *   an existing `withTransaction` flow. If the business change rolls back, its
 *   audit row rolls back with it (R-AUD-2).
 * - `writeAuditBestEffort`: standalone write for auth/denial events (login
 *   failure, refresh reuse, permission denied, logout). Never fails the
 *   request (best-effort by contract).
 *
 * Payloads NEVER contain passwords, token values, refresh hashes or SMTP
 * secrets (R-AUD-3).
 */
export interface AuditEntry {
  action: string
  entity: string
  entityId?: string | null
  actorId?: string | null
  actorUsername?: string | null
  payload?: Record<string, unknown> | null
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (action, entity, entity_id, actor_id, actor_username, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.actorId ?? null,
      entry.actorUsername ?? null,
      JSON.stringify(entry.payload ?? {}),
    ],
  )
}

/** Best-effort: never throws, never fails the request. */
export async function writeAuditBestEffort(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await writeAudit(db, entry)
  } catch (err) {
    console.error(`audit write failed (best-effort, action=${entry.action}):`, err)
  }
}