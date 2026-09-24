import { Router } from 'express'
import type { Db } from '../../db/pool.ts'
import type { AppConfig } from '../../config/env.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { createObservabilityController } from './controller.ts'

/**
 * Observability routes (T-1-8 / T-6-3): GET /api/health (public liveness,
 * R-OBS-1) + GET /api/status (any authenticated user, R-OBS-2, ADR-6).
 */
export function createObservabilityRouter(deps: { db: Db; config: AppConfig }): Router {
  const router = Router()
  const ctrl = createObservabilityController(deps)

  router.get('/health', ctrl.health)
  router.get('/status', requireAuth(deps.config.jwtSecret), ctrl.status)

  return router
}