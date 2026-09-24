import { Router } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config/env.ts'
import { validateDto } from '../../middleware/validate.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createCrmController } from './controller.ts'
import { createCustomerSchema, updateCustomerSchema } from './dto.ts'

/**
 * CRM routes (T-2-4): POST/GET/GET:id/PATCH /api/customers. Permission per the
 * locked matrix: create/update = admin/manager/operator; read = all five roles
 * (requirePermission performs the per-request DB check, R-AUTH-8).
 */
export function createCrmRouter(deps: { db: Pool; config: AppConfig }): Router {
  const router = Router()
  const ctrl = createCrmController(deps)

  router.post(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.crm.customer_create),
    validateDto(createCustomerSchema),
    ctrl.createCustomer,
  )
  router.get(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.crm.customer_read),
    ctrl.listCustomers,
  )
  router.get(
    '/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.crm.customer_read),
    ctrl.getCustomer,
  )
  router.patch(
    '/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.crm.customer_update),
    validateDto(updateCustomerSchema),
    ctrl.updateCustomer,
  )

  return router
}