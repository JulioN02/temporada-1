import { api, buildQuery } from './client.ts'
import type { Job, JobState, Paginated } from './types.ts'

/**
 * Jobs API module (it5 governance). R-UI-JOB-1 (it1 delta): server-side
 * state + queue filters — the UI sends the query params, never filters
 * client-side.
 */
export type JobsListParams = {
  state?: JobState | undefined
  queue?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export function listJobs(params: JobsListParams = {}): Promise<Paginated<Job>> {
  return api.get<Paginated<Job>>(`/api/jobs${buildQuery(params)}`)
}

/** R-JOB-6: retry a failed job (manager+). */
export function retryJob(id: string): Promise<{ job: Job }> {
  return api.post<{ job: Job }>(`/api/jobs/${id}/retry`, {})
}