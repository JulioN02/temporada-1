import { Router } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { AppConfig } from '../../config/env.ts'
import { validateDto } from '../../middleware/validate.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createOrdersController } from './controller.ts'
import { cancelOrderSchema, createOrderSchema } from './dto.ts'

/**
 * Orders routes (T-3-5 + T-4-6): POST/GET/GET:id /api/orders + POST
 * :id/confirm|cancel. Permissions per the locked matrix: create/confirm/cancel
 * = admin/manager/operator; read = all five roles. Confirm is the ATOMIC
 * composition (T-4-6, R-ORD-5); the Idempotency-Key header drives replay.
 */
export function createOrdersRouter(deps: { db: Pool; config: AppConfig; boss: PgBoss }): Router {
  const router = Router()
  const ctrl = createOrdersController(deps)

  router.post(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.orders.order_create),
    validateDto(createOrderSchema),
    ctrl.createOrder,
  )
  router.get(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.orders.order_read),
    ctrl.listOrders,
  )
  router.get(
    '/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.orders.order_read),
    ctrl.getOrder,
  )
  router.post(
    '/:id/confirm',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.orders.order_confirm),
    ctrl.confirmOrder,
  )
  router.post(
    '/:id/cancel',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.orders.order_cancel),
    validateDto(cancelOrderSchema),
    ctrl.cancelOrder,
  )

  return router
}