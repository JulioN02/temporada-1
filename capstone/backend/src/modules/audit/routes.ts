import { Router } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config/env.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createAuditController } from './controller.ts'

/**
 * Audit routes (T-6-1, R-AUD-4): GET /api/audit — `audit:read` granted to
 * admin + auditor only (locked matrix). The append-only write path stays in
 * modules/audit/write.ts (writeAudit / writeAuditBestEffort).
 */
export function createAuditRouter(deps: { db: Pool; config: AppConfig }): Router {
  const router = Router()
  const ctrl = createAuditController(deps)

  router.get(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.audit.read),
    ctrl.list,
  )

  return router
}