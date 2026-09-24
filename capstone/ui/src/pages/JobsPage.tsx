import { useState } from 'react'
import { listJobs, retryJob } from '../api/jobs.ts'
import type { Job, JobState } from '../api/types.ts'
import { JOB_STATES } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { usePagination } from '../hooks/usePagination.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { DataTable } from '../components/DataTable.tsx'
import type { Column } from '../components/DataTable.tsx'
import { Pagination } from '../components/Pagination.tsx'
import { Badge } from '../components/Badge.tsx'
import { ConfirmButton } from '../components/ConfirmButton.tsx'
import { FormField, Input, Select } from '../components/FormField.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { jobStateLabelKey } from '../modules/governance/jobs.ts'

/**
 * Jobs page (it5 T-5-5 — R-UI-JOB-1/2): manager+ (route-guarded). State and
 * queue filters are SERVER-SIDE query params (it1 T-1-7 delta — the UI never
 * filters client-side, R-UI-JOB-1 resolved). Failed rows are visually
 * distinct (danger badge + Retry action). Retry is confirm-gated
 * (POST /api/jobs/:id/retry); success toast 'Trabajo reencolado' + row
 * refresh; a 404 renders the localized not-found message.
 */
const FAILED_STATE: JobState = 'failed'

export function JobsPage() {
  const { t, locale } = useTranslation()
  const [stateFilter, setStateFilter] = useState<JobState | undefined>(undefined)
  const [queueDraft, setQueueDraft] = useState('')
  const [queueFilter, setQueueFilter] = useState<string | undefined>(undefined)
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 20 })

  const { data, loading, error, refetch } = useResource(
    () => listJobs({ state: stateFilter, queue: queueFilter, page, limit }),
    [stateFilter, queueFilter, page, limit],
  )

  async function handleRetry(job: Job): Promise<void> {
    try {
      await retryJob(job.id)
      showToast('success', t('jobs.retryQueued'))
      refetch()
    } catch (err) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        showToast('error', t('jobs.notFound'))
      } else {
        showToast('error', localizeError(err, t))
      }
      refetch()
    }
  }

  function stateTone(state: JobState): 'danger' | 'success' | 'warning' | 'neutral' {
    if (state === 'failed') return 'danger'
    if (state === 'completed') return 'success'
    if (state === 'retry') return 'warning'
    return 'neutral'
  }

  const columns: readonly Column<Job>[] = [
    { key: 'id', header: t('orders.id') },
    { key: 'queue', header: t('jobs.queue') },
    {
      key: 'state',
      header: t('jobs.state'),
      render: (row) => <Badge tone={stateTone(row.state)}>{t(jobStateLabelKey(row.state))}</Badge>,
    },
    {
      key: 'attempts',
      header: t('jobs.attempts'),
      render: (row) => `${row.retryCount}/${row.retryLimit}`,
    },
    { key: 'createdAt', header: t('orders.createdAt'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      // R-UI-JOB-2: retry on failed jobs only (no 'archived' state in v12)
      render: (row) =>
        row.state === FAILED_STATE ? (
          <ConfirmButton label={t('jobs.retry')} onConfirm={() => handleRetry(row)} />
        ) : null,
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('jobs.title')}</h1>
      </div>

      <div className="filters">
        <FormField label={t('jobs.state')} htmlFor="jobs-state">
          <Select
            id="jobs-state"
            value={stateFilter ?? ''}
            onChange={(e) => {
              setStateFilter(e.target.value === '' ? undefined : (e.target.value as JobState))
              resetPage()
            }}
          >
            <option value="">{t('common.all')}</option>
            {JOB_STATES.map((state) => (
              <option key={state} value={state}>
                {t(jobStateLabelKey(state))}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('jobs.queue')} htmlFor="jobs-queue">
          <Input id="jobs-queue" value={queueDraft} onChange={(e) => setQueueDraft(e.target.value)} />
        </FormField>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setQueueFilter(queueDraft.trim() === '' ? undefined : queueDraft.trim())
            resetPage()
          }}
        >
          {t('common.filter')}
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        keyOf={(row) => row.id}
        loading={loading}
        error={error ? localizeError(error, t) : null}
        onRetry={refetch}
        emptyMessage={t('jobs.empty')}
      />
      {data && data.pagination.totalPages > 1 ? (
        <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  )
}