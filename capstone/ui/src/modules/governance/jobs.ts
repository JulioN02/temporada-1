import type { MessageKey } from '../../i18n/types.ts'
import type { JobState } from '../../api/types.ts'

/**
 * Jobs page helpers (it5 T-5-5 — R-UI-JOB-1). The 6 REAL pg-boss v12 states
 * map to localized label keys (the archived 7th 'expired' state does not
 * exist in the installed enum — catalog pinned accordingly, apply-progress
 * deviation #2/#4).
 */
export const JOB_STATE_LABEL_KEYS: Readonly<Record<JobState, MessageKey>> = {
  created: 'jobs.state.created',
  retry: 'jobs.state.retry',
  active: 'jobs.state.active',
  completed: 'jobs.state.completed',
  cancelled: 'jobs.state.cancelled',
  failed: 'jobs.state.failed',
}

export function jobStateLabelKey(state: JobState): MessageKey {
  return JOB_STATE_LABEL_KEYS[state]
}