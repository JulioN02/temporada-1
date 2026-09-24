import { useState } from 'react'
import { listUsers, updateUser } from '../api/users.ts'
import type { PublicUser } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { usePagination } from '../hooks/usePagination.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { DataTable } from '../components/DataTable.tsx'
import type { Column } from '../components/DataTable.tsx'
import { Pagination } from '../components/Pagination.tsx'
import { Modal } from '../components/Modal.tsx'
import { Badge } from '../components/Badge.tsx'
import { ConfirmButton } from '../components/ConfirmButton.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { UserForm } from '../modules/governance/UserForm.tsx'
import { roleLabelKey } from '../modules/governance/userForm.ts'

/**
 * Users page (it5 T-5-3/T-5-4 — R-UI-USR-1..3): admin only (route-guarded).
 * List with localized role + active badges; create/invite modal (NO locale
 * field — R-UI-USR-2 locked delta); edit modal for role changes; row-level
 * deactivate/reactivate is confirm-gated, and self-deactivation is blocked
 * client-side with a localized warning (R-UI-USR-3 — no request fires).
 */
export function UsersPage() {
  const { t, locale } = useTranslation()
  const { user: currentUser } = useAuth()
  const { page, limit, setPage } = usePagination({ limit: 20 })

  const { data, loading, error, refetch } = useResource(() => listUsers({ page, limit }), [page, limit])

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PublicUser | null>(null)

  async function toggleActive(user: PublicUser): Promise<void> {
    // R-UI-USR-3: an admin must not deactivate their OWN account — blocked
    // client-side with a warning, no request.
    if (user.active && currentUser && user.id === currentUser.id) {
      showToast('error', t('users.selfDeactivateBlocked'))
      return
    }
    try {
      await updateUser(user.id, { active: !user.active })
      showToast('success', t('users.updated'))
      refetch()
    } catch (err) {
      showToast('error', localizeError(err, t))
    }
  }

  const columns: readonly Column<PublicUser>[] = [
    { key: 'username', header: t('users.username') },
    { key: 'fullName', header: t('users.fullName'), render: (row) => row.fullName ?? '—' },
    { key: 'email', header: t('users.email') },
    {
      key: 'role',
      header: t('users.role'),
      render: (row) => <Badge tone="info">{t(roleLabelKey(row.role))}</Badge>,
    },
    {
      key: 'active',
      header: t('users.active'),
      render: (row) =>
        row.active ? <Badge tone="success">{t('users.active')}</Badge> : <Badge tone="neutral">{t('users.inactive')}</Badge>,
    },
    { key: 'createdAt', header: t('users.createdAt'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(row)}>
            {t('common.edit')}
          </button>
          <ConfirmButton
            label={row.active ? t('common.deactivate') : t('common.activate')}
            onConfirm={() => toggleActive(row)}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('users.title')}</h1>
        <button type="button" className="btn" onClick={() => setCreating(true)}>
          {t('users.create')}
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        keyOf={(row) => row.id}
        loading={loading}
        error={error ? localizeError(error, t) : null}
        onRetry={refetch}
      />
      {data && data.pagination.totalPages > 1 ? (
        <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
      ) : null}

      {creating ? (
        <Modal title={t('users.create')} onClose={() => setCreating(false)}>
          <UserForm
            mode="create"
            onDone={() => {
              setCreating(false)
              refetch()
            }}
          />
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={t('users.edit')} onClose={() => setEditing(null)}>
          <UserForm
            mode="edit"
            initial={editing}
            onDone={() => {
              setEditing(null)
              refetch()
            }}
          />
        </Modal>
      ) : null}
    </div>
  )
}