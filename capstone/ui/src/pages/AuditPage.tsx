import { useState } from 'react'
import { listAudit } from '../api/audit.ts'
import type { AuditRow } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { usePagination } from '../hooks/usePagination.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { DataTable } from '../components/DataTable.tsx'
import type { Column } from '../components/DataTable.tsx'
import { Pagination } from '../components/Pagination.tsx'
import { FormField, Input } from '../components/FormField.tsx'
import { auditDateRangeToIso } from '../modules/governance/audit.ts'

/**
 * Audit page (it5 T-5-2 — R-UI-AUD-1): admin/auditor only (route-guarded).
 * Filters (entity/action exact-match + from/to dates) apply server-side;
 * rows render newest-first as served. The payload column renders the raw
 * JSON as TEXT (React-escaped — R-UI-NFR-2: a <script> payload displays
 * literally, never executes). Audit rows never store credentials (R-AUD-3).
 */
export function AuditPage() {
  const { t, locale } = useTranslation()
  const [entityDraft, setEntityDraft] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [fromDraft, setFromDraft] = useState('')
  const [toDraft, setToDraft] = useState('')
  const [applied, setApplied] = useState<{ entity?: string | undefined; action?: string | undefined; from?: string | undefined; to?: string | undefined }>({})
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 20 })

  const { data, loading, error, refetch } = useResource(
    () =>
      listAudit({
        entity: applied.entity,
        action: applied.action,
        from: applied.from,
        to: applied.to,
        page,
        limit,
      }),
    [applied.entity, applied.action, applied.from, applied.to, page, limit],
  )

  function applyFilters(): void {
    const range = auditDateRangeToIso(fromDraft, toDraft)
    setApplied({
      entity: entityDraft.trim() === '' ? undefined : entityDraft.trim(),
      action: actionDraft.trim() === '' ? undefined : actionDraft.trim(),
      from: range.from,
      to: range.to,
    })
    resetPage()
  }

  const columns: readonly Column<AuditRow>[] = [
    { key: 'created_at', header: t('audit.timestamp'), render: (row) => formatDateTime(row.created_at, locale) },
    { key: 'actor_username', header: t('audit.actor'), render: (row) => row.actor_username ?? '—' },
    { key: 'entity', header: t('audit.entity') },
    { key: 'entity_id', header: t('audit.entityId'), render: (row) => row.entity_id ?? '—' },
    { key: 'action', header: t('audit.action') },
    {
      key: 'payload',
      header: t('audit.payload'),
      // JSON rendered as TEXT — React escapes it (R-UI-NFR-2)
      render: (row) => (row.payload === null ? '—' : <code className="payload-json">{JSON.stringify(row.payload)}</code>),
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('audit.title')}</h1>
      </div>

      <div className="filters">
        <FormField label={t('audit.entity')} htmlFor="audit-entity">
          <Input id="audit-entity" value={entityDraft} onChange={(e) => setEntityDraft(e.target.value)} />
        </FormField>
        <FormField label={t('audit.action')} htmlFor="audit-action">
          <Input id="audit-action" value={actionDraft} onChange={(e) => setActionDraft(e.target.value)} />
        </FormField>
        <FormField label={t('audit.from')} htmlFor="audit-from">
          <Input id="audit-from" type="date" value={fromDraft} onChange={(e) => setFromDraft(e.target.value)} />
        </FormField>
        <FormField label={t('audit.to')} htmlFor="audit-to">
          <Input id="audit-to" type="date" value={toDraft} onChange={(e) => setToDraft(e.target.value)} />
        </FormField>
        <button type="button" className="btn" onClick={applyFilters}>
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
        emptyMessage={t('audit.empty')}
      />
      {data && data.pagination.totalPages > 1 ? (
        <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  )
}