import type { Db } from '../../db/pool.ts'
import { listAudit, type AuditFilters, type AuditRow } from './repository.ts'

/**
 * Audit read service (T-6-1, R-AUD-4) — framework-independent. Read-only:
 * delegates to the repository and computes the pagination envelope.
 */
export interface AuditListResult {
  items: AuditRow[]
  total: number
  totalPages: number
}

export async function readAudit(db: Db, filters: AuditFilters): Promise<AuditListResult> {
  const { items, total } = await listAudit(db, filters)
  return { items, total, totalPages: Math.max(1, Math.ceil(total / filters.limit)) }
}