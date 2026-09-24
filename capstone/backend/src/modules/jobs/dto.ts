import { z } from 'zod'

/**
 * Jobs module DTOs (T-5-8) — read + retry API for the pg-boss queues
 * (R-JOB-6). Pagination follows the platform convention. capstone-ui it1
 * (T-1-7, R-UI-JOB-1 resolved server-side): optional `state` + `queue`
 * filters — verified against the ACTUAL pgboss.job enum (pg-boss v12 has 6
 * states: created/retry/active/completed/cancelled/failed — the archived
 * design listed a 7th 'expired' that the installed enum does not define;
 * filtering by it could never match a row).
 */
export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const
export type JobState = (typeof JOB_STATES)[number]
const JOB_STATE_VALUES = Object.values(JOB_STATES) as [JobState, ...JobState[]]

export const jobsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: z.enum(JOB_STATE_VALUES).optional(),
  queue: z.string().trim().max(100).optional(),
})

export interface JobsListQuery {
  page: number
  limit: number
  // `| undefined` required: zod v4 optional outputs carry undefined under
  // tsconfig exactOptionalPropertyTypes — the schema must stay assignable to
  // ZodType<JobsListQuery> for parseOrThrow.
  state?: JobState | undefined
  queue?: string | undefined
}