import 'dotenv/config'
import { PgBoss } from 'pg-boss'
import { NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG } from '../src/jobs/queues.ts'

/**
 * Queue bootstrap for the appliance (T-7-2 prod boot race fix).
 *
 * Batch D finding: the request-path enqueuer (createBossEnqueuer) sends via
 * the shared pool with a NEVER-STARTED boss — pg-boss `send()` requires the
 * `pgboss` schema AND the queue row to exist, but the API container may boot
 * before the worker has ever run (worker installs the schema at boot via
 * migrate:true). If the API enqueues first, the send fails.
 *
 * Fix: the compose `migrate` one-shot service runs this script after the SQL
 * migrations (depends_on: service_completed_successfully gates api+worker),
 * so the schema + `notification.send` queue row exist BEFORE the first
 * enqueue. Idempotent: boss.migrate() and createQueue are ON CONFLICT DO
 * NOTHING (queue config is immutable per row — production config wins).
 */
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:55437/bop'

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  const boss = new PgBoss({ connectionString, schema: 'pgboss', migrate: true })
  await boss.start()
  await boss.createQueue(NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG)
  await boss.stop()
  console.log(`pg-boss schema + queue ensured: ${NOTIFICATION_SEND_QUEUE}`)
}

main().catch((err: unknown) => {
  console.error('ensure-queues failed:', err)
  process.exit(1)
})