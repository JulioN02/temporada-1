import type { PgBoss } from 'pg-boss'
import type { Pool } from 'pg'
import { ApiError } from '../../middleware/errorHandler.ts'
import * as jobRepo from './repository.ts'

/**
 * Jobs service (T-5-8): read API over the pg-boss job table + retry redrive
 * (R-JOB-6). `retry` requires the QUEUE name (pg-boss v12 signature
 * `boss.retry(name, id)`) — resolved from the job row itself.
 */

export async function listJobs(
  db: Pool,
  query: { page: number; limit: number; state?: string | undefined; queue?: string | undefined },
): Promise<{ items: jobRepo.JobDto[]; total: number }> {
  return jobRepo.listJobs(db, {
    page: query.page,
    pageSize: query.limit,
    state: query.state,
    queue: query.queue,
  })
}

export async function retryJob(db: Pool, id: string, boss: PgBoss): Promise<jobRepo.JobDto> {
  const job = await jobRepo.findJob(db, id)
  if (!job) {
    throw new ApiError(404, 'NOT_FOUND', 'Job not found')
  }
  await boss.retry(job.queue, job.id)
  const refreshed = await jobRepo.findJob(db, id)
  return refreshed ?? job
}