import crypto from 'node:crypto'
import type { Express } from 'express'
import type { Pool } from 'pg'
import { pino } from 'pino'
import { createApp } from '../../src/app.ts'
import { createTestPool } from './db.ts'
import { createBossEnqueuer } from '../../src/lib/pgBossTx.ts'

export interface TestContext {
  app: Express
  pool: Pool
  jwtSecret: string
  cookieSecret: string
}

/** Silent logger for tests (request logs would flood the suite output). */
const silentLogger = pino({ level: 'silent' })

/** Fresh app + pool per test context; secrets generated per run (never hardcoded). */
export function createTestContext(): TestContext {
  const jwtSecret = crypto.randomBytes(32).toString('hex')
  const cookieSecret = crypto.randomBytes(32).toString('hex')
  const pool = createTestPool()
  const app = createApp({
    db: pool,
    config: { jwtSecret, cookieSecret, isProduction: false, appVersion: 'test' },
    logger: silentLogger,
    // Request-path enqueuer (T-5-6): never-started boss on the SAME test pool
    // — in-tx email enqueue without extra connections or timers.
    boss: createBossEnqueuer(pool),
  })
  return { app, pool, jwtSecret, cookieSecret }
}