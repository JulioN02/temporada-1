import type { Db } from '../../db/pool.ts'

/**
 * Notifications repository (T-5-6). Data access ONLY — parameterized SQL
 * (R-NFR-1), no business rules (service layer). Rows are per recipient per
 * channel (Batch C deviation #1: UNIQUE(type, reference, channel, user_id)).
 */

export interface NotificationRow {
  id: string
  user_id: string
  type: string
  channel: string
  title: string
  body: string
  reference: string
  read_at: string | null
  delivery_state: string
  created_at: string
}

export interface MyNotificationDto {
  id: string
  type: string
  channel: string
  title: string
  body: string
  reference: string
  readAt: string | null
  deliveryState: string
  createdAt: string
}

export function toMyNotificationDto(row: NotificationRow): MyNotificationDto {
  return {
    id: row.id,
    type: row.type,
    channel: row.channel,
    title: row.title,
    body: row.body,
    reference: row.reference,
    readAt: row.read_at,
    deliveryState: row.delivery_state,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export interface ListMineOptions {
  unreadOnly: boolean
  page: number
  pageSize: number
}

/** R-NOT-1: the caller's OWN in-app rows, newest first, paginated. */
export async function listMine(
  db: Db,
  userId: string,
  opts: ListMineOptions,
): Promise<{ items: MyNotificationDto[]; total: number }> {
  const where = opts.unreadOnly
    ? "user_id = $1 AND channel = 'in_app' AND read_at IS NULL"
    : "user_id = $1 AND channel = 'in_app'"
  const total = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE ${where}`,
    [userId],
  )
  const offset = (opts.page - 1) * opts.pageSize
  const { rows } = await db.query<NotificationRow>(
    `SELECT id, user_id, type, channel, title, body, reference, read_at, delivery_state, created_at
     FROM notifications
     WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, opts.pageSize, offset],
  )
  return { items: rows.map(toMyNotificationDto), total: total.rows[0]!.n }
}

/**
 * R-NOT-1: mark ONE in-app row read — owner-scoped AND idempotent: updating an
 * already-read OWN row still succeeds (204); 0 affected rows only when the row
 * does not belong to the caller (→ 404, identical for missing/foreign rows).
 */
export async function markRead(db: Db, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE notifications SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND channel = 'in_app'`,
    [id, userId],
  )
  return (rowCount ?? 0) > 0
}

/** R-NOT-1: unread counter (in-app rows) for the current user. */
export async function unreadCount(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
    [userId],
  )
  return rows[0]!.n
}

/** Email-channel row + recipient address (worker delivery lookup). */
export interface EmailDeliveryRow {
  id: string
  to: string
  subject: string
  text: string
  delivery_state: string
}

/** Worker: fetch an email-channel notification with the recipient's address. */
export async function findEmailById(db: Db, id: string): Promise<EmailDeliveryRow | null> {
  const { rows } = await db.query<EmailDeliveryRow>(
    `SELECT n.id, u.email AS to, n.title AS subject, n.body AS text, n.delivery_state
     FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.id = $1 AND n.channel = 'email'`,
    [id],
  )
  return rows[0] ?? null
}

/** Worker: delivery_state transition (pending → sent | failed). R-NOT-4. */
export async function markDeliveryState(db: Db, id: string, state: 'sent' | 'failed'): Promise<void> {
  await db.query(`UPDATE notifications SET delivery_state = $2 WHERE id = $1`, [id, state])
}

/** Worker boot reconciliation (ADR-2 safety net): email rows never attempted. */
export async function findPendingEmails(db: Db): Promise<Array<{ id: string }>> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM notifications WHERE channel = 'email' AND delivery_state = 'pending'`,
  )
  return rows
}

/** Reconciliation guard: does ANY job (any state) reference this notification? */
export async function jobExistsForNotification(db: Db, notificationId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = 'notification.send' AND data->>'notificationId' = $1`,
    [notificationId],
  )
  return rows[0]!.n > 0
}