import type { MessageKey } from '../../i18n/types.ts'

/**
 * Notification display helpers (it5 T-5-1 — R-UI-NOT-1). The stored
 * title/body are rendered VERBATIM (snapshot rendered at emit, R-BE-3 —
 * never re-rendered client-side); only the TYPE and CHANNEL identifiers are
 * mapped to localized labels. Unknown values render raw (no silent
 * assumption — the backend may add types later).
 */
export const NOTIFICATION_TYPE_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  order_confirmed: 'notifications.type.orderConfirmed',
  order_cancelled: 'notifications.type.orderCancelled',
  low_stock: 'notifications.type.lowStock',
  stock_adjusted: 'notifications.type.stockAdjusted',
  stock_transferred: 'notifications.type.stockTransferred',
  user_invited: 'notifications.type.userInvited',
  job_failed: 'notifications.type.jobFailed',
}

/** Backend type string → localized label key (null → render raw). */
export function notificationTypeLabelKey(type: string): MessageKey | null {
  return NOTIFICATION_TYPE_LABEL_KEYS[type] ?? null
}

export const NOTIFICATION_CHANNEL_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  in_app: 'notifications.channel.inApp',
  email: 'notifications.channel.email',
}

/** Backend channel string → localized label key (null → render raw). */
export function channelLabelKey(channel: string): MessageKey | null {
  return NOTIFICATION_CHANNEL_LABEL_KEYS[channel] ?? null
}