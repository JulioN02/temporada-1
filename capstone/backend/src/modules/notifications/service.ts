import type { Db } from '../../db/pool.ts'
import { ApiError } from '../../middleware/errorHandler.ts'
import * as notifRepo from './repository.ts'

/**
 * Notifications service (T-5-7): in-app API rules — R-NOT-1 owner scope
 * (404 on anyone else's row), idempotent mark-read (204 even when already
 * read), unread counter. Pure business rules; data access in the repository.
 */

export interface NotificationsListQuery {
  unreadOnly: boolean
  page: number
  limit: number
}

export async function listNotifications(
  db: Db,
  userId: string,
  query: NotificationsListQuery,
): Promise<{ items: notifRepo.MyNotificationDto[]; total: number }> {
  return notifRepo.listMine(db, userId, {
    unreadOnly: query.unreadOnly,
    page: query.page,
    pageSize: query.limit,
  })
}

/** R-NOT-1: owner-scoped mark-read — 0 affected rows → 404 (not the owner). */
export async function markNotificationRead(db: Db, userId: string, id: string): Promise<void> {
  const updated = await notifRepo.markRead(db, userId, id)
  if (!updated) {
    // Either the row does not exist or it belongs to another user — identical 404.
    throw new ApiError(404, 'NOT_FOUND', 'Notification not found')
  }
}

export async function getUnreadCount(db: Db, userId: string): Promise<number> {
  return notifRepo.unreadCount(db, userId)
}