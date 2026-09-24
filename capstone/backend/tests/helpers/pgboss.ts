import { PgBoss } from 'pg-boss'
import { testDatabaseUrl } from './db.ts'

/**
 * Test-DB pg-boss bootstrap (T-5-2): installs the `pgboss` schema (idempotent,
 * migrate:true) — schema ONLY, no queue. The queue row is created/reset by
 * `resetDatabase` (helpers/db.ts) with the production config every test,
 * because pg-boss `create_queue` is ON CONFLICT DO NOTHING: the queue config
 * is immutable per row and every job SNAPSHOTS it at insert time. Tests that
 * need a different retry profile (R-JOB-3/R-JOB-6 DLQ flows) swap the queue
 * row explicitly BEFORE enqueueing.
 *
 * The schema survives `resetDatabase` (pg-boss tables live in `pgboss`, not
 * `public`); `resetDatabase` truncates `pgboss.job` between tests instead.
 *
 * Request-path tests (R-ORD-5 email assertion, R-NOT-3, ...) need the schema
 * because `emitEvent` enqueues through the API's never-started enqueuer, and
 * pg-boss `send()` requires the schema (and the queue row) to exist.
 */
let installPromise: Promise<void> | null = null

export function ensurePgbossSchema(): Promise<void> {
  installPromise ??= (async () => {
    const boss = new PgBoss({
      connectionString: testDatabaseUrl(),
      schema: 'pgboss',
      migrate: true,
    })
    await boss.start()
    await boss.stop()
  })()
  return installPromise
}