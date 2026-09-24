import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import { parseOrThrow } from '../../middleware/validate.ts'
import type { JobsListQuery } from './dto.ts'
import { jobsListQuerySchema } from './dto.ts'
import * as jobsService from './service.ts'

/**
 * Jobs controller (T-5-8) — orchestration only (R-NFR-4). R-JOB-6:
 * GET /api/jobs (manager+) + POST /api/jobs/:id/retry (manager+).
 */
export interface JobsController {
  list: (req: Request, res: Response) => Promise<void>
  retry: (req: Request, res: Response) => Promise<void>
}

export function createJobsController(deps: { db: Pool; boss: PgBoss }): JobsController {
  const { db, boss } = deps

  async function list(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<JobsListQuery>(jobsListQuerySchema, req.query)
    const result = await jobsService.listJobs(db, query)
    res.json({
      data: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
      },
    })
  }

  async function retry(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } })
      return
    }
    const job = await jobsService.retryJob(db, id, boss)
    res.json({ job })
  }

  return { list, retry }
}