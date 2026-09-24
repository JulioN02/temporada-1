import { PgBoss } from 'pg-boss'
import type { Db as BossDb, QueueOptions } from 'pg-boss'
import type { Pool } from 'pg'
import type { Db } from '../db/pool.ts'

/**
 * pg-boss v12 db-adapter factory (T-5-2, ADR-2 — SPIKE-validated, see
 * docs/spike-pgboss-tx.md). pg-boss v12 "Atomic Job Insertion" lets a caller
 * hand `send(queue, data, { db })` an `IDatabase` whose `executeSql` runs
 * inside the CALLER's transaction — the job row commits/rolls back with the
 * business tx (exactly-once, R-NOT-6; no outbox, no poller).
 *
 * Two adapter flavors:
 * - `createDbAdapter(db)`: binds `executeSql` to ANY queryable (transaction
 *   client or pool). Used INSIDE `withTransaction` for atomic enqueue, and by
 *   the worker boot reconciliation.
 * - `createBossEnqueuer(pool)`: a NEVER-STARTED boss instance backed by the
 *   shared app pool (queue-cache lookups flow through our pool too). The
 *   request path enqueues through it; it runs no timers, no maintenance, no
 *   extra connection pool (SPIKE finding #3). Must NEVER be stopped.
 *
 * Schema note: the worker installs the `pgboss` schema at boot (migrate:true);
 * tests install it via tests/helpers/pgboss.ts.
 */

export function createDbAdapter(db: Db): BossDb {
  return {
    executeSql: (text: string, values?: unknown[]) => db.query(text, values as unknown[]),
  }
}

/** Pool-backed adapter for a never-started, enqueue-only boss instance. */
function createPoolAdapter(pool: Pool): BossDb {
  return {
    executeSql: (text: string, values?: unknown[]) => pool.query(text, values as unknown[]),
  }
}

/** Enqueue-only boss: same pool, no timers, no maintenance (SPIKE finding #3). */
export function createBossEnqueuer(pool: Pool): PgBoss {
  return new PgBoss({ schema: 'pgboss', db: createPoolAdapter(pool) })
}

const ensuredQueues = new WeakMap<PgBoss, Set<string>>()

/**
 * Idempotent queue bootstrap. pg-boss `create_queue` is ON CONFLICT DO NOTHING
 * — the queue row (and its retry config, which every job SNAPSHOTS at insert
 * time) is immutable after creation. So this helper only creates the queue
 * when it does NOT exist yet; an existing queue keeps whatever config it was
 * created with (production: the worker's boot config; tests: the per-test
 * config). Cached per instance so the request path never re-checks after the
 * first enqueue.
 */
export async function ensureQueue(
  boss: PgBoss,
  name: string,
  config: QueueOptions,
): Promise<void> {
  const seen = ensuredQueues.get(boss) ?? new Set<string>()
  if (seen.has(name)) return
  const existing = await boss.getQueue(name)
  if (!existing) await boss.createQueue(name, config)
  seen.add(name)
}