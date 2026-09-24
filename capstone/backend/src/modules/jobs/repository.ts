import type { Db } from '../../db/pool.ts'

/**
 * Jobs repository (T-5-8): reads the pg-boss job table DIRECTLY (read-only,
 * parameterized — R-NFR-1). NOTE (REPORTED deviation): pg-boss v12 has NO
 * separate archive table — every job state (created/retry/active/completed/
 * cancelled/failed) lives in `pgboss.job` with a `state` column; "pgboss.job
 * ∪ archive" (design §8) therefore collapses to one table.
 */

export interface JobRecord {
  id: string
  name: string
  state: string
  retry_count: number
  retry_limit: number
  created_on: string
  completed_on: string | null
  notification_id: string | null
  output: unknown
}

export interface JobDto {
  id: string
  queue: string
  state: string
  retryCount: number
  retryLimit: number
  notificationId: string | null
  createdAt: string
  completedAt: string | null
}

export function toJobDto(row: JobRecord): JobDto {
  return {
    id: row.id,
    queue: row.name,
    state: row.state,
    retryCount: row.retry_count,
    retryLimit: row.retry_limit,
    notificationId: row.notification_id,
    createdAt: new Date(row.created_on).toISOString(),
    completedAt: row.completed_on ? new Date(row.completed_on).toISOString() : null,
  }
}

export async function listJobs(
  db: Db,
  opts: { page: number; pageSize: number; state?: string | undefined; queue?: string | undefined },
): Promise<{ items: JobDto[]; total: number }> {
  // R-NFR-1 / R-UI-JOB-1: parameterized WHERE — count and data share the SAME
  // predicate (COUNT parity: pagination.total always matches the filtered set).
  const where: string[] = []
  const values: unknown[] = []
  if (opts.state !== undefined) {
    values.push(opts.state)
    where.push(`state = $${values.length}`)
  }
  if (opts.queue !== undefined) {
    values.push(opts.queue)
    where.push(`name = $${values.length}`)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM pgboss.job ${whereSql}`,
    values,
  )
  const offset = (opts.page - 1) * opts.pageSize
  const { rows } = await db.query<JobRecord>(
    `SELECT id, name, state, retry_count, retry_limit, created_on, completed_on,
            data->>'notificationId' AS notification_id, output
     FROM pgboss.job
     ${whereSql}
     ORDER BY created_on DESC, id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, opts.pageSize, offset],
  )
  return { items: rows.map(toJobDto), total: total.rows[0]!.n }
}

/** Single job lookup by id (any state). */
export async function findJob(db: Db, id: string): Promise<JobDto | null> {
  const { rows } = await db.query<JobRecord>(
    `SELECT id, name, state, retry_count, retry_limit, created_on, completed_on,
            data->>'notificationId' AS notification_id, output
     FROM pgboss.job WHERE id = $1`,
    [id],
  )
  return rows[0] ? toJobDto(rows[0]!) : null
}