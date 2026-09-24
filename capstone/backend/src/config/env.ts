import 'dotenv/config'
import { z } from 'zod'

/**
 * Environment contract (R-PROD-5): zod fail-fast at boot, never echoes secret
 * values. The schema validates variable NAMES + constraints; error messages
 * mention the offending variable only (values are never rendered).
 */

export interface AppConfig {
  jwtSecret: string
  cookieSecret: string
  isProduction: boolean
  appVersion: string
}

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export interface ParsedEnv {
  NODE_ENV: 'development' | 'test' | 'production'
  PORT: number
  DATABASE_URL: string
  appConfig: AppConfig
  smtp: SmtpConfig
  pgBoss: { schema: string | null; pollingIntervalSeconds: number | null }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters (HS256)'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
  APP_VERSION: z.string().min(1).default('dev'),
  // SMTP is optional in dev/test (mailpit defaults); REQUIRED in production
  // (validated below — no silent mailpit default in prod).
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(1).optional(),
  PG_BOSS_SCHEMA: z.string().min(1).optional(),
  PG_BOSS_POLLING_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
})

/**
 * Parses an env record (defaults `process.env` via getEnv). Throws on invalid
 * input — the message lists variable names + reasons, NEVER values.
 */
export function parseEnv(input: Record<string, string | undefined>): ParsedEnv {
  const parsed = EnvSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)'
      return `${path}: ${issue.message}`
    })
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`)
  }
  const data = parsed.data

  // Production requires explicit SMTP credentials (no mailpit fallback).
  if (data.NODE_ENV === 'production') {
    const required: Array<[string, string | undefined]> = [
      ['SMTP_HOST', data.SMTP_HOST],
      ['SMTP_PORT', data.SMTP_PORT === undefined ? undefined : String(data.SMTP_PORT)],
      ['SMTP_USER', data.SMTP_USER],
      ['SMTP_PASS', data.SMTP_PASS],
      ['SMTP_FROM', data.SMTP_FROM],
    ]
    const missing = required
      .filter(([, value]) => value === undefined || value === '')
      .map(([name]) => `${name}: required in production`)
    if (missing.length > 0) {
      throw new Error(`Invalid environment configuration:\n${missing.join('\n')}`)
    }
  }

  return {
    NODE_ENV: data.NODE_ENV,
    PORT: data.PORT,
    DATABASE_URL: data.DATABASE_URL,
    smtp: {
      host: data.SMTP_HOST ?? 'mailpit',
      port: data.SMTP_PORT ?? 1025,
      user: data.SMTP_USER ?? '',
      pass: data.SMTP_PASS ?? '',
      from: data.SMTP_FROM ?? 'bop@localhost',
    },
    pgBoss: {
      schema: data.PG_BOSS_SCHEMA ?? null,
      pollingIntervalSeconds: data.PG_BOSS_POLLING_INTERVAL_SECONDS ?? null,
    },
    appConfig: {
      jwtSecret: data.JWT_SECRET,
      cookieSecret: data.COOKIE_SECRET,
      isProduction: data.NODE_ENV === 'production',
      appVersion: data.APP_VERSION,
    },
  }
}

/** Fail-fast boot-time parse of process.env. Throws → non-zero exit (R-PROD-5). */
export function getEnv(): ParsedEnv {
  return parseEnv(process.env)
}