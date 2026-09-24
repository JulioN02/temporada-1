import type { Db } from '../../db/pool.ts'
import { NOTIFICATION_SEND_QUEUE } from '../../jobs/queues.ts'

/**
 * Observability repository (T-6-3) — the ONLY DB access in the module
 * (R-NFR-4: no SQL in controllers). Two bounded pings:
 *
 * - pingDb: pure `SELECT 1` raced against a 2s timeout (R-OBS-1 liveness).
 * - pingQueues: pgboss reachability raced against a 500ms timeout.
 *
 * NOTE (REPORTED deviation): design ADR-6 says `queues` from `boss.ping()`,
 * but pg-boss v12 has NO ping() API (verified in dist types — removed after
 * v9). Replaced with an equivalent bounded SQL ping of the `pgboss.queue`
 * row via the shared pool: schema missing / queue missing / DB unreachable →
 * "down". Same signal, same never-blocks guarantee.
 */

export async function pingDb(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    db
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 2000)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function pingQueues(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    db
      .query('SELECT 1 FROM pgboss.queue WHERE name = $1', [NOTIFICATION_SEND_QUEUE])
      .then((result) => (result.rowCount ?? 0) > 0)
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 500)
    }),
  ]).finally(() => clearTimeout(timer))
}