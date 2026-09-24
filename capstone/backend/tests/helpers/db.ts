import 'dotenv/config'
import { createPool } from '../../src/db/pool.ts'
import type { Pool } from 'pg'
import { ensurePgbossSchema } from './pgboss.ts'
import { NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG } from '../../src/jobs/queues.ts'

/** Derives the test database URL from DATABASE_URL (same compose container). */
export function testDatabaseUrl(): string {
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55437/bop',
  )
  url.pathname = '/bop_test'
  return url.toString()
}

export function createTestPool(): Pool {
  return createPool(testDatabaseUrl())
}

/**
 * Runtime-owned rows reset per test. Roles/permissions stay seeded by migration.
 * Batch C: movements + notifications added (it4 ledger + emit rows).
 * Batch D: pgboss schema bootstrapped once per process (T-5-2) and the
 * `notification.send` QUEUE ROW reset to the PRODUCTION config every test —
 * pg-boss `create_queue` is ON CONFLICT DO NOTHING (config immutable per row)
 * and jobs snapshot the config at insert time, so each test must start from
 * the canonical queue. Tests needing a custom retry profile (R-JOB-3/R-JOB-6)
 * swap the row explicitly BEFORE enqueueing. TRUNCATE ... CASCADE resolves FK
 * dependencies regardless of list order.
 */
const TRUNCATE_TABLES =
  'movements, notifications, order_items, orders, customers, products, warehouses, refresh_tokens, user_roles, users, audit_log'

export async function resetDatabase(pool: Pool): Promise<void> {
  await ensurePgbossSchema()
  await pool.query(`TRUNCATE TABLE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`)
  await pool.query('TRUNCATE TABLE pgboss.job RESTART IDENTITY CASCADE')
  // Reset the queue row to the canonical production config.
  await pool.query(`DELETE FROM pgboss.queue WHERE name = $1`, [NOTIFICATION_SEND_QUEUE])
  await pool.query(`SELECT pgboss.create_queue($1, $2::jsonb)`, [
    NOTIFICATION_SEND_QUEUE,
    JSON.stringify({ ...NOTIFICATION_SEND_QUEUE_CONFIG, policy: 'standard' }),
  ])
}