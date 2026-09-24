import type { PgBoss } from 'pg-boss'
import type { JobWithMetadata } from 'pg-boss'
import type { Pool } from 'pg'
import { writeAudit } from '../modules/audit/write.ts'
import { emitEvent } from '../modules/notifications/emit.ts'
import { NOTIFICATION_TYPES } from '../modules/notifications/types.ts'
import * as notifRepo from '../modules/notifications/repository.ts'
import type { Mailer } from './mailer.ts'
import type { Logger } from '../lib/logger.ts'

/**
 * Worker handlers (T-5-4). `notification.send` jobs carry `{ notificationId }`
 * pointing at an EMAIL-channel notification row — the row's title/body are the
 * immutable template snapshot (rendered at emit time); the worker only needs
 * the recipient address. SMTP failures NEVER touch a business transaction
 * (the API tx already committed — R-NOT-4/R-NOT-6): the handler throws so
 * pg-boss retries with backoff and dead-letters after retryLimit (failed state
 * = DLQ, R-JOB-1/R-JOB-3).
 *
 * Lifecycle audit (R-JOB-5): `job.created` was written IN-TX at enqueue time;
 * `job.completed` / `job.failed` are written here (pg-boss v12 has no
 * `onComplete` — REPORTED deviation: the v9-style completion hook no longer
 * exists, so completion/failure auditing lives in the handler).
 *
 * Idempotency (R-JOB-4): a row already `sent` is skipped — a duplicate
 * delivery attempt (retry, replay, reconciliation race) never re-sends.
 */

export interface NotificationJobData {
  notificationId: string
}

export interface WorkerDeps {
  pool: Pool
  mailer: Mailer
  logger: Logger
  /** The worker's boss instance (used for in-tx job_failed emit only). */
  boss: PgBoss
}

/** True when this attempt is the LAST one (matching pg-boss canRetry semantics). */
export function isTerminalAttempt(job: JobWithMetadata<NotificationJobData>): boolean {
  return job.retryCount >= job.retryLimit
}

async function processOne(job: JobWithMetadata<NotificationJobData>, deps: WorkerDeps): Promise<void> {
  const { pool, mailer, logger, boss } = deps
  const notificationId = job.data.notificationId

  const delivery = await notifRepo.findEmailById(pool, notificationId)
  if (!delivery) {
    logger.warn({ jobId: job.id, notificationId }, 'email notification row missing — completing job')
    return
  }
  if (delivery.delivery_state === 'sent') {
    // R-JOB-4: already delivered — never re-send (idempotent handler).
    logger.info({ jobId: job.id, notificationId }, 'notification already sent — skipping')
    return
  }

  try {
    await mailer.sendMail({ to: delivery.to, subject: delivery.subject, text: delivery.text })
    await notifRepo.markDeliveryState(pool, notificationId, 'sent')
    await writeAudit(pool, {
      action: 'job.completed',
      entity: 'job',
      entityId: job.id,
      payload: { queue: job.name, notificationId },
    })
    logger.info({ jobId: job.id, notificationId, to: delivery.to }, 'email delivered')
  } catch (err) {
    const attempt = job.retryCount + 1
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ jobId: job.id, notificationId, attempt, error: message }, 'email send failed')
    if (isTerminalAttempt(job)) {
      // Last attempt → dead letter: mark the row failed, audit, notify operators.
      await notifRepo.markDeliveryState(pool, notificationId, 'failed')
      await writeAudit(pool, {
        action: 'job.failed',
        entity: 'job',
        entityId: job.id,
        payload: { queue: job.name, notificationId, attempt, error: message },
      })
      await emitEvent(
        pool,
        {
          type: NOTIFICATION_TYPES.jobFailed,
          reference: `job:${job.id}:failed`,
          payload: { queue: job.name, jobId: job.id, attempt },
        },
        boss,
      )
    }
    throw err // pg-boss: retry with backoff, or dead-letter (failed state)
  }
}

/** Batch handler for the notification.send queue (pg-boss v12 work() receives arrays). */
export async function processNotificationSendJobs(
  jobs: JobWithMetadata<NotificationJobData>[],
  deps: WorkerDeps,
): Promise<void> {
  for (const job of jobs) {
    await processOne(job, deps)
  }
}