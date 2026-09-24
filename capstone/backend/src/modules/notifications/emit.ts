import type { PgBoss } from 'pg-boss'
import type { Db } from '../../db/pool.ts'
import { writeAudit } from '../audit/write.ts'
import { createDbAdapter, ensureQueue } from '../../lib/pgBossTx.ts'
import { NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG } from '../../jobs/queues.ts'
import { renderNotification } from '../../jobs/templates.ts'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TARGETS,
  type NotificationType,
} from './types.ts'

/**
 * Notification EMIT (T-5-6, full — replaces the it4 S3 subset). Called INSIDE
 * the business transaction by domain services (orders confirm/cancel, stock
 * choke, auth user create). Contract (SPIKE-concluded, docs/spike-pgboss-tx.md):
 *
 *   1. Resolve recipients per NOTIFICATION_TARGETS (ADR-4) — in-tx, WITH each
 *      recipient's stored `users.locale` (capstone-ui it1, R-BE-3).
 *   2. For each channel of the type's matrix (R-NOT-2): INSERT a row per
 *      recipient with `ON CONFLICT (type, reference, channel, user_id) DO
 *      NOTHING RETURNING id` — replay/retry of the same event is a no-op
 *      (exactly-once, R-NOT-6).
 *   3. The template is rendered ONCE per recipient in their locale at emit
 *      time (R-NOT-5 modified): title/body/locale are the immutable snapshot
 *      stored on the row — the worker NEVER re-renders.
 *   4. Only a row that was ACTUALLY INSERTED enqueues an email job via the
 *      pg-boss db adapter (same tx — the job commits/rolls back with the
 *      domain event, R-ORD-5/R-NOT-6) + a `job.created` audit row.
 *
 * The request path NEVER sends mail (R-NOT-3): enqueuing is its only side
 * effect; the worker owns the SMTP send.
 */

export interface EmitEventInput {
  type: NotificationType
  reference: string
  payload: Record<string, unknown>
  /** Explicit recipients for creator/invitee-targeted types (ADR-4). */
  recipientUserIds?: string[]
}

/** Recipient row: id + stored locale (R-BE-3 — per-recipient rendering). */
export interface Recipient {
  id: string
  locale: string
}

/** R-NOT-5 fallback: only the whitelisted locales render; anything else → es. */
function resolveLocale(stored: string): 'es' | 'en' {
  return stored === 'en' ? 'en' : 'es'
}

async function resolveRoleRecipients(db: Db, roles: readonly string[]): Promise<Recipient[]> {
  if (roles.length === 0) return []
  const placeholders = roles.map((_, index) => `$${index + 1}`).join(', ')
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.locale
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.active = true AND r.code IN (${placeholders})`,
    [...roles],
  )
  return rows as Recipient[]
}

/** Creator/invitee kinds: explicit ids → their stored locales (in-tx). */
async function lookupUsers(db: Db, userIds: string[]): Promise<Recipient[]> {
  if (userIds.length === 0) return []
  const placeholders = userIds.map((_, index) => `$${index + 1}`).join(', ')
  const { rows } = await db.query(
    `SELECT id, locale FROM users WHERE id IN (${placeholders})`,
    userIds,
  )
  return rows as Recipient[]
}

function resolveRecipients(
  db: Db,
  target: (typeof NOTIFICATION_TARGETS)[NotificationType],
  input: EmitEventInput,
): Promise<Recipient[]> {
  switch (target.recipients.kind) {
    case 'creator':
    case 'invitee':
      return lookupUsers(db, input.recipientUserIds ?? [])
    case 'roles':
      return resolveRoleRecipients(db, target.recipients.roles)
  }
}

/** Atomic email enqueue: pg-boss send through the tx adapter + lifecycle audit. */
async function enqueueEmail(
  db: Db,
  notificationId: string,
  type: NotificationType,
  enqueuer: PgBoss,
): Promise<void> {
  await ensureQueue(enqueuer, NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG)
  const jobId = await enqueuer.send(
    NOTIFICATION_SEND_QUEUE,
    { notificationId },
    { db: createDbAdapter(db) },
  )
  if (!jobId) return // singleton-skip (not used today) — nothing to audit
  await writeAudit(db, {
    action: 'job.created',
    entity: 'job',
    entityId: jobId,
    payload: { queue: NOTIFICATION_SEND_QUEUE, notificationId, type },
  })
}

/**
 * Full emit: rows per recipient per channel + in-tx email enqueue (T-5-6).
 * R-BE-3: each row renders the template ONCE in its recipient's locale and
 * stores the rendered snapshot + locale (immutable history, R-NOT-5). The
 * enqueuer is the request-path boss (never started, shared pool).
 */
export async function emitEvent(
  db: Db,
  input: EmitEventInput,
  enqueuer: PgBoss,
): Promise<void> {
  const target = NOTIFICATION_TARGETS[input.type]
  const recipients = await resolveRecipients(db, target, input)
  if (recipients.length === 0) return

  for (const channel of target.channels) {
    for (const recipient of recipients) {
      const locale = resolveLocale(recipient.locale)
      const { title, body } = renderNotification(input.type, input.payload, locale)
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO notifications (user_id, type, channel, title, body, reference, locale)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (type, reference, channel, user_id) DO NOTHING
         RETURNING id`,
        [recipient.id, input.type, channel, title, body, input.reference, locale],
      )
      const inserted = rows[0]?.id
      if (inserted && channel === NOTIFICATION_CHANNELS.email) {
        await enqueueEmail(db, inserted, input.type, enqueuer)
      }
    }
  }
}