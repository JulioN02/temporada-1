import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'
import { ApiError } from './errorHandler.ts'

/**
 * Zod DTO validation middleware. On success the parsed (typed) value replaces
 * req.body; on failure it forwards a uniform 422 with issue details.
 */
export function validateDto<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(new ApiError(422, 'VALIDATION_ERROR', 'Invalid request payload', toIssueDetails(result.error)))
      return
    }
    req.body = result.data
    next()
  }
}

/** Parses an arbitrary value (e.g. req.query) with a zod schema or throws the uniform 422. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid query parameters', toIssueDetails(result.error))
  }
  return result.data
}

function toIssueDetails(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}