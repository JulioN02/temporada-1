import type { RequestHandler } from 'express'
import type { Db } from '../db/pool.ts'
import { hasPermission } from '../modules/auth/repository.ts'
import { writeAuditBestEffort } from '../modules/audit/write.ts'
import type { Permission } from '../permissions/registry.ts'
import { ApiError } from './errorHandler.ts'

/**
 * R-AUTH-8: RBAC enforcement with a per-request DB check (role lookup via
 * user_roles — no JWT-embedded permissions, no cache). Runs AFTER requireAuth:
 * missing user → 401. Missing permission → 403 FORBIDDEN (+ best-effort
 * denial audit that never fails the request).
 */
export function requirePermission(db: Db, permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Authentication required'))
      return
    }
    try {
      const allowed = await hasPermission(db, req.user.id, permission)
      if (!allowed) {
        await writeAuditBestEffort(db, {
          action: 'auth.permission.denied',
          entity: 'route',
          entityId: `${req.method} ${req.path}`,
          actorId: req.user.id,
          actorUsername: req.user.username,
          payload: { permission, method: req.method, path: req.path },
        })
        next(new ApiError(403, 'FORBIDDEN', `Missing permission: ${permission}`))
        return
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}