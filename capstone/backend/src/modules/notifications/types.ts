/**
 * Notification registries (T-5-5, ADR-3/ADR-4). Const-type pattern (typescript
 * skill): const objects + mapped unions — never bare string unions.
 *
 * - NOTIFICATION_TYPES: the 7 LOCKED event types (spec R-NOT-2, DB CHECK in
 *   005_notifications.sql — parity asserted in tests/unit/templates.test.ts).
 * - NOTIFICATION_TARGETS: per-type channel matrix (R-NOT-2) + recipient
 *   targeting (ADR-4) — the single source of truth for emitEvent.
 *
 * Channel matrix (locked, spec §6.1):
 *   order_confirmed   both | order_cancelled   both | low_stock     both
 *   stock_adjusted    in-app | stock_transferred in-app | user_invited email
 *   job_failed        in-app
 */

export const NOTIFICATION_CHANNELS = {
  inApp: 'in_app',
  email: 'email',
} as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS]

export const NOTIFICATION_TYPES = {
  orderConfirmed: 'order_confirmed',
  orderCancelled: 'order_cancelled',
  lowStock: 'low_stock',
  stockAdjusted: 'stock_adjusted',
  stockTransferred: 'stock_transferred',
  userInvited: 'user_invited',
  jobFailed: 'job_failed',
} as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

/** ADR-4 recipient targeting: explicit user or role-based resolution. */
export type RecipientTarget =
  | { kind: 'creator' } // order events → order.created_by
  | { kind: 'invitee' } // user_invited → the invited user
  | { kind: 'roles'; roles: readonly string[] } // active users holding any role

export interface NotificationTarget {
  channels: readonly NotificationChannel[]
  recipients: RecipientTarget
}

export const NOTIFICATION_TARGETS: Record<NotificationType, NotificationTarget> = {
  order_confirmed: {
    channels: [NOTIFICATION_CHANNELS.inApp, NOTIFICATION_CHANNELS.email],
    recipients: { kind: 'creator' },
  },
  order_cancelled: {
    channels: [NOTIFICATION_CHANNELS.inApp, NOTIFICATION_CHANNELS.email],
    recipients: { kind: 'creator' },
  },
  low_stock: {
    channels: [NOTIFICATION_CHANNELS.inApp, NOTIFICATION_CHANNELS.email],
    recipients: { kind: 'roles', roles: ['manager', 'operator'] },
  },
  stock_adjusted: {
    channels: [NOTIFICATION_CHANNELS.inApp],
    recipients: { kind: 'roles', roles: ['admin', 'manager'] },
  },
  stock_transferred: {
    channels: [NOTIFICATION_CHANNELS.inApp],
    recipients: { kind: 'roles', roles: ['admin', 'manager'] },
  },
  user_invited: {
    channels: [NOTIFICATION_CHANNELS.email],
    recipients: { kind: 'invitee' },
  },
  job_failed: {
    channels: [NOTIFICATION_CHANNELS.inApp],
    recipients: { kind: 'roles', roles: ['admin', 'manager'] },
  },
}

/** All channel values accepted by the 005 CHECK (helper for parity assertions). */
export const ALL_CHANNELS: readonly NotificationChannel[] = [
  NOTIFICATION_CHANNELS.inApp,
  NOTIFICATION_CHANNELS.email,
]