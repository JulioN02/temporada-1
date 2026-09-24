import { useState } from 'react'
import { listNotifications, markRead } from '../api/notifications.ts'
import type { Notification } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { usePagination } from '../hooks/usePagination.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { DataTable } from '../components/DataTable.tsx'
import type { Column } from '../components/DataTable.tsx'
import { Pagination } from '../components/Pagination.tsx'
import { Badge } from '../components/Badge.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { channelLabelKey, notificationTypeLabelKey } from '../modules/governance/notifications.ts'
import { notifyUnreadChanged } from '../modules/governance/unreadBus.ts'

/**
 * Notifications page (it5 T-5-1 — R-UI-NOT-1..3). OWN rows only (backend
 * owner scope, R-NOT-1). The stored title/body snapshot renders VERBATIM
 * (R-BE-3 — never re-rendered client-side, R-UI-NOT-1 scenario); type and
 * channel identifiers are localized through the label maps. Mark-read is
 * idempotent (POST /:id/read 204 — double-mark is a no-op, R-UI-NOT-2) and
 * notifies the shell unread bus so the sidebar badge refreshes (R-UI-NOT-3).
 */
export function NotificationsPage() {
  const { t, locale } = useTranslation()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 10 })

  const { data, loading, error, refetch } = useResource(
    () => listNotifications({ unreadOnly: unreadOnly ? true : undefined, page, limit }),
    [unreadOnly, page, limit],
  )

  const [readOverrides, setReadOverrides] = useState<ReadonlySet<string>>(new Set())

  async function handleMarkRead(id: string): Promise<void> {
    try {
      await markRead(id) // 204 idempotent — already-read rows stay 204
      setReadOverrides((prev) => new Set(prev).add(id))
      notifyUnreadChanged() // sidebar badge refresh (R-UI-NOT-3)
      refetch()
    } catch (err) {
      showToast('error', localizeError(err, t))
    }
  }

  function isRead(row: Notification): boolean {
    return row.readAt !== null || readOverrides.has(row.id)
  }

  const columns: readonly Column<Notification>[] = [
    {
      key: 'type',
      header: t('notifications.columnType'),
      render: (row) => {
        const key = notificationTypeLabelKey(row.type)
        return key ? t(key) : row.type
      },
    },
    {
      key: 'channel',
      header: t('notifications.columnChannel'),
      render: (row) => {
        const key = channelLabelKey(row.channel)
        return key ? t(key) : row.channel
      },
    },
    { key: 'title', header: t('notifications.columnTitle') },
    { key: 'body', header: t('notifications.columnBody') },
    { key: 'createdAt', header: t('notifications.columnDate'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'state',
      header: t('notifications.columnState'),
      render: (row) =>
        isRead(row) ? (
          <Badge tone="neutral">{t('notifications.read')}</Badge>
        ) : (
          <Badge tone="info">{t('notifications.unread')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <button type="button" className="btn btn-sm" onClick={() => void handleMarkRead(row.id)}>
          {t('notifications.markRead')}
        </button>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('notifications.title')}</h1>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.target.checked)
              resetPage()
            }}
          />
          {t('notifications.unreadOnly')}
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        keyOf={(row) => row.id}
        loading={loading}
        error={error ? localizeError(error, t) : null}
        onRetry={refetch}
        emptyMessage={t('notifications.empty')}
      />
      {data && data.pagination.totalPages > 1 ? (
        <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  )
}