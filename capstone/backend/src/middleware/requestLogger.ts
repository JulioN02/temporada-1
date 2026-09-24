import crypto from 'node:crypto'
import type { RequestHandler } from 'express'
import type { Logger } from '../lib/logger.ts'

/**
 * One pino JSON line per request: {method, path, status, durationMs, requestId}
 * (R-OBS-3). Request bodies are never logged; pino redact covers auth headers
 * and cookies. requestId is also echoed as the x-request-id response header.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = crypto.randomUUID()
    const startedAt = performance.now()
    // Capture the path at request START: mounted routers rewrite req.url/
    // req.path downstream, so the finish-time value would be router-relative.
    const path = req.path
    res.setHeader('x-request-id', requestId)
    res.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt)
      logger.info(
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs,
          requestId,
        },
        'request',
      )
    })
    next()
  }
}