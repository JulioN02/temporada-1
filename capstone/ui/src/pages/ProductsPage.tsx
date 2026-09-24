import { useState } from 'react'
import { listProducts, updateProduct } from '../api/products.ts'
import type { Product } from '../api/types.ts'
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
import { RoleGate } from '../components/RoleGate.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { ProductForm } from '../modules/crm/ProductForm.tsx'

/**
 * Products page (it3 T-3-5/6 — R-UI-CRM-5..7): searchable catalog with
 * inactive badges, create form (sku regex, threshold >= 0, 409
 * DUPLICATE_SKU localized), and confirm-gated edit/deactivate via
 * PATCH /api/products/:id (never hard-delete — R-UI-CRM-7).
 */
export function ProductsPage() {
  const { t, locale } = useTranslation()
  const [query, setQuery] = useState('')
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 10 })

  const { data, loading, error, refetch } = useResource(
    () => listProducts({ q: query === '' ? undefined : query, page, limit }),
    [query, page, limit],
  )

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)

  async function toggleActive(product: Product): Promise<void> {
    try {
      await updateProduct(product.id, { active: !product.active })
      refetch()
    } catch (err) {
      showToast('error', localizeError(err, t))
    }
  }

  const columns: readonly Column<Product>[] = [
    { key: 'name', header: t('crm.product.name') },
    { key: 'sku', header: t('crm.product.sku') },
    {
      key: 'lowStockThreshold',
      header: t('crm.product.lowStockThreshold'),
      render: (row) => String(row.lowStockThreshold),
    },
    {
      key: 'active',
      header: t('crm.customer.status'),
      render: (row) => (row.active ? <Badge tone="success">{t('users.active')}</Badge> : <Badge tone="neutral">{t('crm.product.inactive')}</Badge>),
    },
    { key: 'createdAt', header: t('crm.product.createdAt'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="row-actions">
          <RoleGate permission="stock:product_manage">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(row)}>
              {t('common.edit')}
            </button>
            <ConfirmButton
              label={row.active ? t('crm.product.deactivate') : t('common.activate')}
              confirmLabel={row.active ? t('crm.product.confirmDeactivate') : t('common.confirm')}
              onConfirm={() => toggleActive(row)}
            />
          </RoleGate>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('crm.product.listTitle')}</h1>
        <RoleGate permission="stock:product_manage">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            {t('crm.product.create')}
          </button>
        </RoleGate>
      </div>

      <div className="filters">
        <DebouncedSearchInput
          placeholder={t('common.search')}
          onSearch={(q) => {
            setQuery(q)
            resetPage()
          }}
        />
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
        <Modal title={t('crm.product.create')} onClose={() => setCreating(false)}>
          <ProductForm
            mode="create"
            onDone={() => {
              setCreating(false)
              refetch()
            }}
          />
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={t('crm.product.edit')} onClose={() => setEditing(null)}>
          <ProductForm
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