import { Router } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config/env.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createNotificationsController } from './controller.ts'

/**
 * Notifications routes (T-5-7). R-NOT-1: read/update of OWN rows is open to
 * ALL five roles (permission matrix: notification:read/update on every role);
 * owner scope is enforced in the service/repository, never by role.
 */
export function createNotificationsRouter(deps: { db: Pool; config: AppConfig }): Router {
  const router = Router()
  const ctrl = createNotificationsController(deps)

  router.get(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.notification.read),
    ctrl.list,
  )
  router.get(
    '/unread-count',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.notification.read),
    ctrl.unreadCount,
  )
  router.post(
    '/:id/read',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.notification.update),
    ctrl.markRead,
  )

  return router
}