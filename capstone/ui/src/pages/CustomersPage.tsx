import { useEffect, useState } from 'react'
import { listCustomers, updateCustomer } from '../api/customers.ts'
import type { Customer, CustomerStatus } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { usePagination } from '../hooks/usePagination.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { DataTable } from '../components/DataTable.tsx'
import type { Column } from '../components/DataTable.tsx'
import { Pagination } from '../components/Pagination.tsx'
import { Modal } from '../components/Modal.tsx'
import { Badge } from '../components/Badge.tsx'
import { ConfirmButton } from '../components/ConfirmButton.tsx'
import { DebouncedSearchInput } from '../components/DebouncedSearchInput.tsx'
import { Select } from '../components/FormField.tsx'
import { RoleGate } from '../components/RoleGate.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { CustomerForm } from '../modules/crm/CustomerForm.tsx'

/**
 * Customers page (it3 T-3-2..T-3-4 — R-UI-CRM-1..4): debounced search,
 * status filter (inactive hidden by default — backend default), pagination,
 * create/edit modals with localized validation, and confirm-gated
 * deactivate/reactivate (R-UI-CRM-4 — cancel fires nothing).
 */
export function CustomersPage() {
  const { t, locale } = useTranslation()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | undefined>(undefined)
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 10 })

  const { data, loading, error, refetch } = useResource(
    () => listCustomers({ q: query === '' ? undefined : query, status: statusFilter, page, limit }),
    [query, statusFilter, page, limit],
  )

  // R-UI-CRM-1 403 scenario: the list API denies → localized denial toast,
  // never a crash. The ErrorState renders the same localized message.
  useEffect(() => {
    if (error && (error as { code?: string }).code === 'FORBIDDEN') {
      showToast('error', localizeError(error, t))
    }
  }, [error, t])

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)

  async function toggleStatus(customer: Customer): Promise<void> {
    try {
      await updateCustomer(customer.id, {
        status: customer.status === 'active' ? 'inactive' : 'active',
      })
      refetch()
    } catch (err) {
      showToast('error', localizeError(err, t))
    }
  }

  const columns: readonly Column<Customer>[] = [
    { key: 'name', header: t('crm.customer.name') },
    { key: 'email', header: t('crm.customer.email'), render: (row) => row.email ?? '—' },
    { key: 'phone', header: t('crm.customer.phone'), render: (row) => row.phone ?? '—' },
    {
      key: 'status',
      header: t('crm.customer.status'),
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
          {row.status === 'active' ? t('users.active') : t('users.inactive')}
        </Badge>
      ),
    },
    { key: 'createdAt', header: t('crm.customer.createdAt'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="row-actions">
          <RoleGate permission="crm:customer_update">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(row)}>
              {t('common.edit')}
            </button>
            <ConfirmButton
              label={row.status === 'active' ? t('common.deactivate') : t('common.activate')}
              onConfirm={() => toggleStatus(row)}
            />
          </RoleGate>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('crm.customer.listTitle')}</h1>
        <RoleGate permission="crm:customer_create">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            {t('crm.customer.create')}
          </button>
        </RoleGate>
      </div>

      <div className="filters">
        <DebouncedSearchInput
          placeholder={t('crm.customer.searchPlaceholder')}
          onSearch={(q) => {
            setQuery(q)
            resetPage()
          }}
        />
        <Select
          aria-label={t('crm.customer.statusFilter')}
          value={statusFilter ?? ''}
          onChange={(e) => {
            setStatusFilter(e.target.value === '' ? undefined : (e.target.value as CustomerStatus))
            resetPage()
          }}
        >
          <option value="">{t('common.all')}</option>
          <option value="active">{t('users.active')}</option>
          <option value="inactive">{t('users.inactive')}</option>
        </Select>
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
        <Modal title={t('crm.customer.create')} onClose={() => setCreating(false)}>
          <CustomerForm
            mode="create"
            onDone={() => {
              setCreating(false)
              refetch()
            }}
          />
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={t('crm.customer.edit')} onClose={() => setEditing(null)}>
          <CustomerForm
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