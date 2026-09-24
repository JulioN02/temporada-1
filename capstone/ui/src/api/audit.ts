import { api, buildQuery } from './client.ts'
import type { AuditRow, Paginated } from './types.ts'

/** Audit API module (it5 governance; read-only, newest-first). */

export type AuditListParams = {
  entity?: string | undefined
  action?: string | undefined
  from?: string | undefined
  to?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

/** Rows are served snake_case as-is (repository rows — R-UI-AUD-1). */
export function listAudit(params: AuditListParams = {}): Promise<Paginated<AuditRow>> {
  return api.get<Paginated<AuditRow>>(`/api/audit${buildQuery(params)}`)
}