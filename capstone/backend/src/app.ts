// MUST be the first import: extends the shared zod instance with `.openapi()`
// BEFORE any DTO module creates its schemas (zod v4 copies methods per
// instance at creation time — see src/openapi/extend.ts).
import './openapi/extend.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Express } from 'express'
import express from 'express'
import cookieParser from 'cookie-parser'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { AppConfig } from './config/env.ts'
import { createLogger, type Logger } from './lib/logger.ts'
import { createBossEnqueuer } from './lib/pgBossTx.ts'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts'
import { requestLogger } from './middleware/requestLogger.ts'
import { createSpaFallback } from './middleware/spaFallback.ts'
import { createAuthRouter, createUsersRouter } from './modules/auth/routes.ts'
import { createCrmRouter } from './modules/crm/routes.ts'
import { createOrdersRouter } from './modules/orders/routes.ts'
import { createStockRouter } from './modules/stock/routes.ts'
import { createNotificationsRouter } from './modules/notifications/routes.ts'
import { createJobsRouter } from './modules/jobs/routes.ts'
import { createAuditRouter } from './modules/audit/routes.ts'
import { createObservabilityRouter } from './modules/observability/routes.ts'
import { createDocsRouter } from './openapi/registry.ts'

export interface AppDeps {
  db: Pool
  config: AppConfig
  logger?: Logger
  /**
   * Request-path pg-boss enqueuer (T-5-6, ADR-2): never-started boss on the
   * shared pool — in-tx email job enqueue only. Defaults to a pool-backed
   * enqueuer; tests inject their own (same pool).
   */
  boss?: PgBoss
  /**
   * Vite build directory served as static + SPA fallback root (T-1-8, R-BE-5).
   * Injectable so backend SPA tests point at a temp fixture dir — hermetic,
   * no Vite build required. Defaults to `capstone/ui/dist`.
   */
  uiDistDir?: string
}

/**
 * Application factory (T-1-6). Dependency-injectable so tests build the app
 * with their own pool, secrets and logger (no module-level side effects).
 */
export function createApp({
  db,
  config,
  logger = createLogger(),
  boss = createBossEnqueuer(db),
  uiDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui/dist'),
}: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(requestLogger(logger))
  app.use(cookieParser(config.cookieSecret))
  app.use(express.json({ limit: '100kb' }))

  app.use('/api/auth', createAuthRouter({ db, config, boss }))
  app.use('/api/users', createUsersRouter({ db, config, boss }))
  app.use('/api/customers', createCrmRouter({ db, config }))
  app.use('/api/orders', createOrdersRouter({ db, config, boss }))
  app.use('/api', createStockRouter({ db, config, boss }))
  app.use('/api/notifications', createNotificationsRouter({ db, config }))
  app.use('/api/jobs', createJobsRouter({ db, config, boss }))
  app.use('/api/audit', createAuditRouter({ db, config }))
  app.use('/api', createObservabilityRouter({ db, config }))
  app.use('/api', createDocsRouter(config))

  // R-BE-5 (capstone-ui it1): SPA serving — ordering per design ADR-4.8:
  // API routers → static(uiDistDir) → SPA fallback (non-/api GET) → JSON 404
  // for /api → errorHandler. Static assets win over the fallback.
  app.use(express.static(uiDistDir))

  // Minimal verification UI (T-7-5, R-PROD-7, ADR-12): static vanilla JS
  // served by the API at / (repo capstone/ui; /app/ui inside the container).
  // NOTE (it2 deviation, documented): the vanilla files were REMOVED at
  // T-2-1 (R-PROD-7 modified — the suite now asserts the SPA shell). The
  // mount itself is KEPT: in dev-without-vite it serves the Vite source
  // index.html (harmless; the SPA takes over via ui/dist + fallback in prod).
  const vanillaUiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui')
  app.use(express.static(vanillaUiDir))

  app.use(createSpaFallback(uiDistDir))

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}