import type { ErrorRequestHandler, RequestHandler } from 'express'

/**
 * Shared error primitives. Every error response uses the uniform shape
 * `{ error: { code, message } }` (spec error contract):
 * - 401 UNAUTHORIZED (identical body everywhere, no enumeration)
 * - 403 FORBIDDEN
 * - 404 NOT_FOUND
 * - 409 <SUBCODE> (USERNAME_TAKEN, DUPLICATE_EMAIL, INVALID_STATE, ...)
 * - 422 VALIDATION_ERROR (message carries UNKNOWN_<ENTITY> per ADR-1)
 * - 500 INTERNAL_ERROR (generic — never leaks internals)
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** PostgreSQL unique-violation (23505) → 409 conflicts. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  )
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  })
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    // Uniform wire shape {error:{code,message}} — details never leave the server.
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }
  // Never leak internals; generic 500 for unexpected failures.
  console.error('Unhandled error:', err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
}