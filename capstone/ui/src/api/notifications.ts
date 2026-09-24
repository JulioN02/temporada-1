import { api, buildQuery } from './client.ts'
import type { Notification, Paginated } from './types.ts'

/** Notifications API module (it5 governance; owner-scoped rows). */

export type NotificationsListParams = {
  unreadOnly?: boolean | undefined
  page?: number | undefined
  limit?: number | undefined
}

export function listNotifications(
  params: NotificationsListParams = {},
): Promise<Paginated<Notification>> {
  return api.get<Paginated<Notification>>(`/api/notifications${buildQuery(params)}`)
}

/** Idempotent 204 (R-UI-NOT-2). */
export function markRead(id: string): Promise<null> {
  return api.post<null>(`/api/notifications/${id}/read`, {})
}