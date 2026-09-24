import 'dotenv/config'
import { PgBoss } from 'pg-boss'
import type { JobWithMetadata } from 'pg-boss'
import type { Pool } from 'pg'
import { getEnv } from './config/env.ts'
import { createPool } from './db/pool.ts'
import { createLogger, type Logger } from './lib/logger.ts'
import { createDbAdapter, ensureQueue } from './lib/pgBossTx.ts'
import { createSmtpMailer } from './jobs/mailer.ts'
import { processNotificationSendJobs, type NotificationJobData } from './jobs/handlers.ts'
import { NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG } from './jobs/queues.ts'
import * as notifRepo from './modules/notifications/repository.ts'

/**
 * WORKER entrypoint (T-5-4) — the second backend process (server.ts is the
 * API). Boot: env fail-fast (R-PROD-5) → pool → SMTP mailer → pg-boss
 * (installs the `pgboss` schema via migrate) → queue bootstrap → boot
 * reconciliation (ADR-2 safety net) → consume `notification.send` →
 * graceful shutdown on SIGTERM/SIGINT (boss.stop → pool.end → exit 0).
 *
 * The request path NEVER imports this file or the mailer (R-NOT-3): the API
 * only enqueues; the worker owns the SMTP send.
 */

/** ADR-2 safety net: re-enqueue email notifications left pending without a job. */
async function reconcile(boss: PgBoss, pool: Pool, logger: Logger): Promise<void> {
  const pending = await notifRepo.findPendingEmails(pool)
  for (const row of pending) {
    if (await notifRepo.jobExistsForNotification(pool, row.id)) continue
    const jobId = await boss.send(
      NOTIFICATION_SEND_QUEUE,
      { notificationId: row.id },
      { db: createDbAdapter(pool) },
    )
    if (jobId) {
      logger.info({ notificationId: row.id, jobId }, 'reconciliation re-enqueued pending email notification')
    }
  }
}

async function main(): Promise<void> {
  const config = getEnv()
  const logger = createLogger()
  const pool = createPool(config.DATABASE_URL)
  const mailer = createSmtpMailer(config.smtp)

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: 'pgboss',
    migrate: true, // installs/upgrades the pgboss schema at boot
  })
  await boss.start()
  await ensureQueue(boss, NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG)
  logger.info({ queue: NOTIFICATION_SEND_QUEUE, version: config.appConfig.appVersion }, 'BOP worker started')

  await reconcile(boss, pool, logger)

  await boss.work(
    NOTIFICATION_SEND_QUEUE,
    {
      includeMetadata: true,
      pollingIntervalSeconds: config.pgBoss.pollingIntervalSeconds ?? 2,
    },
    (jobs: JobWithMetadata<NotificationJobData>[]) =>
      processNotificationSendJobs(jobs, { pool, mailer, logger, boss }),
  )

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down')
    try {
      await boss.stop() // stop workers, close pool (graceful, 30s bound)
    } catch (err) {
      logger.error({ err }, 'error during boss stop')
    }
    await pool.end()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  console.error('Worker fatal:', err)
  process.exit(1)
})