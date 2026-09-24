import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import { parseOrThrow } from '../../middleware/validate.ts'
import type { NotificationsListQuery } from './dto.ts'
import { notificationsListQuerySchema } from './dto.ts'
import * as notifService from './service.ts'

/**
 * Notifications controller (T-5-7) — orchestration only, every endpoint ≤15
 * lines (R-NFR-4). R-NOT-1: ALL routes are owner-scoped by `req.user.id` —
 * a user can only ever read/update their OWN rows (404 otherwise).
 */
export interface NotificationsController {
  list: (req: Request, res: Response) => Promise<void>
  unreadCount: (req: Request, res: Response) => Promise<void>
  markRead: (req: Request, res: Response) => Promise<void>
}

export function createNotificationsController(deps: { db: Pool }): NotificationsController {
  const { db } = deps

  async function list(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<NotificationsListQuery>(notificationsListQuerySchema, req.query)
    const result = await notifService.listNotifications(db, req.user!.id, query)
    res.json({
      data: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
      },
    })
  }

  async function unreadCount(req: Request, res: Response): Promise<void> {
    const count = await notifService.getUnreadCount(db, req.user!.id)
    res.json({ count })
  }

  async function markRead(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } })
      return
    }
    await notifService.markNotificationRead(db, req.user!.id, id)
    res.status(204).end()
  }

  return { list, unreadCount, markRead }
}