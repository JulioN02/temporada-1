import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { ApiError } from './errorHandler.ts'

/**
 * R-AUTH-3/R-NFR-5: verifies the Bearer access token with jwt.verify (never
 * jwt.decode alone), enforces `exp` (verify) and the `typ === 'access'` claim.
 * Missing / malformed / expired / wrong-typ tokens → uniform 401 UNAUTHORIZED
 * (never 403 — 401 unauthenticated vs 403 unauthorized).
 */
export function requireAuth(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!token) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Authentication required'))
      return
    }
    try {
      const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload & {
        sub?: unknown
        username?: unknown
        role?: unknown
        typ?: unknown
      }
      if (
        payload.typ !== 'access' ||
        typeof payload.sub !== 'string' ||
        typeof payload.username !== 'string' ||
        typeof payload.role !== 'string'
      ) {
        next(new ApiError(401, 'UNAUTHORIZED', 'Invalid token'))
        return
      }
      req.user = { id: payload.sub, username: payload.username, role: payload.role }
      next()
    } catch {
      next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'))
    }
  }
}