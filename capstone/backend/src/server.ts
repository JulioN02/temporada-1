import 'dotenv/config'
import { getEnv } from './config/env.ts'
import { createPool } from './db/pool.ts'
import { createApp } from './app.ts'
import { createLogger } from './lib/logger.ts'

/**
 * API entrypoint: env (fail-fast, R-PROD-5) → pool → app → listen.
 * Any invalid env throws here → process exits non-zero (never echoes secrets).
 */
const config = getEnv()
const logger = createLogger()
const pool = createPool(config.DATABASE_URL)
const app = createApp({ db: pool, config: config.appConfig, logger })

app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, version: config.appConfig.appVersion, nodeEnv: config.NODE_ENV },
    'BOP API listening',
  )
})