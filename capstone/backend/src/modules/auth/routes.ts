import { Router } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { AppConfig } from '../../config/env.ts'
import { validateDto } from '../../middleware/validate.ts'
import { requireAuth } from '../../middleware/requireAuth.ts'
import { requirePermission } from '../../middleware/requirePermission.ts'
import { PERMISSIONS } from '../../permissions/registry.ts'
import { createAuthController } from './controller.ts'
import { createUserSchema, loginSchema, patchMeSchema, updateUserSchema } from './dto.ts'

export function createAuthRouter(deps: { db: Pool; config: AppConfig; boss: PgBoss }): Router {
  const router = Router()
  const ctrl = createAuthController(deps)

  // Public (cookie-based refresh) + authenticated session endpoints.
  router.post('/login', validateDto(loginSchema), ctrl.login)
  router.post('/refresh', ctrl.refresh)
  router.post('/logout', requireAuth(deps.config.jwtSecret), ctrl.logout)
  router.get('/me', requireAuth(deps.config.jwtSecret), ctrl.me)
  // R-BE-4 (capstone-ui it1): self-service locale — auth required, 422 invalid.
  router.patch('/me', requireAuth(deps.config.jwtSecret), validateDto(patchMeSchema), ctrl.patchMe)

  return router
}

/**
 * User management — R-AUTH-1: admin-only (auth:user_create / user_read /
 * user_update per the matrix). No self-registration endpoint exists.
 */
export function createUsersRouter(deps: { db: Pool; config: AppConfig; boss: PgBoss }): Router {
  const router = Router()
  const ctrl = createAuthController(deps)

  router.post(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.auth.user_create),
    validateDto(createUserSchema),
    ctrl.createUser,
  )
  router.get(
    '/',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.auth.user_read),
    ctrl.listUsers,
  )
  router.patch(
    '/:id',
    requireAuth(deps.config.jwtSecret),
    requirePermission(deps.db, PERMISSIONS.auth.user_update),
    validateDto(updateUserSchema),
    ctrl.updateUser,
  )

  return router
}