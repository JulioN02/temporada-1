import { Router } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { AppConfig } from '../../config/env.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createJobsController } from './controller.ts'

/**
 * Jobs routes (T-5-8). R-JOB-6: the jobs API is manager+ — `jobs:job_read` /
 * `jobs:job_retry` are granted to admin + manager only (locked matrix).
 */
export function createJobsRouter(deps: { db: Pool; config: AppConfig; boss: PgBoss }): Router {
  const router = Router()
  const ctrl = createJobsController(deps)

  router.get(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.jobs.job_read),
    ctrl.list,
  )
  router.post(
    '/:id/retry',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.jobs.job_retry),
    ctrl.retry,
  )

  return router
}