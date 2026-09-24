import { pino } from 'pino'
import type { DestinationStream, Logger } from 'pino'

export type { Logger }

/**
 * Shared pino logger. Redact paths cover auth material by construction
 * (R-NFR-2): authorization headers, cookies, passwords, tokens, SMTP secrets.
 * Request/response bodies are never logged (secrets excluded by construction).
 *
 * NOTE (deviation from design §10 list): pino treats `*.token` as an exact
 * nested key and `smtp*` as a literal segment — the design's list alone does
 * NOT redact camelCase keys (accessToken) or smtpPass at top level. The spec
 * contract (R-NFR-2/R-NOT-3: values never logged) is authoritative, so the
 * practical keys are added below; the design list is kept as a floor.
 */
export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.token',
        'token',
        'accessToken',
        'refreshToken',
        'smtp*',
        'smtpHost',
        'smtpPort',
        'smtpUser',
        'smtpPass',
        'smtpFrom',
      ],
    },
    destination,
  )
}