import type { QueueOptions } from 'pg-boss'

/**
 * Queue registry (T-5-2, R-JOB-1). Single queue for the whole platform:
 * `notification.send` — every email-channel notification row enqueues a job
 * here (exactly-once per row, R-NOT-6).
 *
 * DEAD-LETTER (design §8): pg-boss `failed` state IS the dead letter — no
 * separate DLQ queue. Failed jobs stay retained in the job table with their
 * retryCount as attempt evidence (R-JOB-3) and are redriven via the
 * POST /api/jobs/:id/retry API (R-JOB-6).
 *
 * NOTE (REPORTED deviation): pg-boss v12 `retryDelay` is in SECONDS. The
 * design's "retryDelay 1000" (ms reading) maps to the documented intent in
 * design §8 — "retryBackoff true (exponential 1s base)" → retryDelay: 1
 * (1-second base, doubling with jitter up to retryDelayMax 60s).
 */
export const NOTIFICATION_SEND_QUEUE = 'notification.send' as const

export const NOTIFICATION_SEND_QUEUE_CONFIG: QueueOptions = {
  retryLimit: 5, // R-JOB-1: >= 3
  retryBackoff: true, // exponential backoff (2^n with jitter)
  retryDelay: 1, // seconds — 1s base
  retryDelayMax: 60, // cap the backoff at 1 minute
  expireInSeconds: 900, // 15 minutes in active state before re-claim
}