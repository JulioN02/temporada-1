import { Router } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { AppConfig } from '../../config/env.ts'
import { validateDto } from '../../middleware/validate.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createStockController } from './controller.ts'
import {
  createProductSchema,
  createWarehouseSchema,
  movementCreateSchema,
  transferCreateSchema,
  updateProductSchema,
  updateWarehouseSchema,
} from './dto.ts'

/**
 * Stock routes (T-3-6 + T-4-5): catalog CRUD (product_manage/stock_read) +
 * POST /api/stock/movements (stock_adjust), POST /api/stock/transfers
 * (stock_transfer), GET /api/stock + GET /api/stock/movements (stock_read).
 * Permissions per the locked matrix (spec §5).
 */
export function createStockRouter(deps: { db: Pool; config: AppConfig; boss: PgBoss }): Router {
  const router = Router()
  const ctrl = createStockController(deps)

  router.post(
    '/products',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.product_manage),
    validateDto(createProductSchema),
    ctrl.createProduct,
  )
  router.get(
    '/products',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.stock_read),
    ctrl.listProducts,
  )
  // R-UI-CRM-7 (capstone-ui it1, delta approved): product edit/deactivate.
  router.patch(
    '/products/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.product_manage),
    validateDto(updateProductSchema),
    ctrl.updateProduct,
  )
  router.post(
    '/warehouses',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.product_manage),
    validateDto(createWarehouseSchema),
    ctrl.createWarehouse,
  )
  // R-UI-CRM-8 (capstone-ui it1): warehouse list (pickers) + rename + delete.
  router.get(
    '/warehouses',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.stock_read),
    ctrl.listWarehouses,
  )
  router.patch(
    '/warehouses/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.product_manage),
    validateDto(updateWarehouseSchema),
    ctrl.updateWarehouse,
  )
  router.delete(
    '/warehouses/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.product_manage),
    ctrl.deleteWarehouse,
  )
  router.post(
    '/stock/movements',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.stock_adjust),
    validateDto(movementCreateSchema),
    ctrl.createMovement,
  )
  router.post(
    '/stock/transfers',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.stock_transfer),
    validateDto(transferCreateSchema),
    ctrl.createTransfer,
  )
  router.get(
    '/stock',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.stock_read),
    ctrl.getStock,
  )
  router.get(
    '/stock/movements',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.stock.stock_read),
    ctrl.listMovements,
  )

  return router
}