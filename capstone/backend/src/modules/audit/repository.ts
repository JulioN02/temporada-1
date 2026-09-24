import type { Db } from '../../db/pool.ts'

/**
 * Audit read repository (T-6-1, R-AUD-4). All SQL parameterized (R-NFR-1);
 * filters are exact matches, ordering is newest-first with id DESC tie-break.
 * Two queries (count + page) — same shape as the other paginated reads.
 */
export interface AuditRow {
  id: string
  action: string
  entity: string
  entity_id: string | null
  actor_id: string | null
  actor_username: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export interface AuditFilters {
  entity?: string | undefined
  action?: string | undefined
  from?: string | undefined
  to?: string | undefined
  page: number
  limit: number
}

export interface AuditPage {
  items: AuditRow[]
  total: number
}

const BASE_SELECT =
  'SELECT id, action, entity, entity_id, actor_id, actor_username, payload, created_at FROM audit_log'

export async function listAudit(db: Db, filters: AuditFilters): Promise<AuditPage> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.entity !== undefined) {
    params.push(filters.entity)
    conditions.push(`entity = $${params.length}`)
  }
  if (filters.action !== undefined) {
    params.push(filters.action)
    conditions.push(`action = $${params.length}`)
  }
  if (filters.from !== undefined) {
    params.push(filters.from)
    conditions.push(`created_at >= $${params.length}`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    conditions.push(`created_at <= $${params.length}`)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const count = await db.query(`SELECT COUNT(*)::int AS n FROM audit_log${where}`, params)
  const offset = (filters.page - 1) * filters.limit
  params.push(filters.limit, offset)
  const rows = await db.query(
    `${BASE_SELECT}${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { items: rows.rows as AuditRow[], total: count.rows[0]!.n as number }
}