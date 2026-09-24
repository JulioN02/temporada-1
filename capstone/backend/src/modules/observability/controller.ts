import type { Request, Response } from 'express'
import type { Db } from '../../db/pool.ts'
import type { AppConfig } from '../../config/env.ts'
import { pingDb, pingQueues } from './repository.ts'

/**
 * Observability controller (T-1-8 health, T-6-3 status). Orchestration only,
 * ≤15 lines per endpoint (R-NFR-4); all SQL lives in repository.ts.
 *
 * - GET /api/health (public, R-OBS-1): liveness for Docker HEALTHCHECK →
 *   200 {status:"ok", db:"up"} | 503 {status:"degraded", db:"down"}.
 * - GET /api/status (any authenticated user, R-OBS-2 + ADR-6): readiness →
 *   {version, uptimeSeconds, db, timestamp, queues} — `queues` is the
 *   ADDITIVE ADR-6 field (dead-worker signal), never blocks the response.
 */
export interface ObservabilityController {
  health: (req: Request, res: Response) => Promise<void>
  status: (req: Request, res: Response) => Promise<void>
}

export function createObservabilityController(deps: {
  db: Db
  config: AppConfig
}): ObservabilityController {
  async function health(_req: Request, res: Response): Promise<void> {
    const up = await pingDb(deps.db)
    if (up) {
      res.json({ status: 'ok', db: 'up' })
    } else {
      res.status(503).json({ status: 'degraded', db: 'down' })
    }
  }

  async function status(_req: Request, res: Response): Promise<void> {
    const [dbUp, queuesUp] = await Promise.all([pingDb(deps.db), pingQueues(deps.db)])
    res.json({
      version: deps.config.appVersion,
      uptimeSeconds: Math.floor(process.uptime()),
      db: dbUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
      queues: queuesUp ? 'up' : 'down',
    })
  }

  return { health, status }
}