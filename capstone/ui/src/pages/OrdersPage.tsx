import { useState, useOptimistic } from 'react'
import { confirmOrder, listOrders } from '../api/orders.ts'
import type { OrderListItem } from '../api/types.ts'
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
import { MoneyText } from '../components/MoneyText.tsx'
import { ConfirmButton } from '../components/ConfirmButton.tsx'
import { Select } from '../components/FormField.tsx'
import { RoleGate } from '../components/RoleGate.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { CreateOrderForm } from '../modules/orders/CreateOrderForm.tsx'
import { CancelOrderModal } from '../modules/orders/CancelOrderModal.tsx'

/**
 * Orders page (it4 T-4-5..T-4-8 — R-UI-ORD-1/3/4/5). State filter +
 * pagination + localized state badges; actions per state (draft: Confirm +
 * Cancel, confirmed: Cancel, cancelled: none). Confirm runs the ATOMIC
 * two-step + useOptimistic flow (design §4.2): optimistic pending →
 * POST confirm (Idempotency-Key) → success toast + refetch; 409
 * INSUFFICIENT_STOCK → rollback (server truth: still draft, zero order_out
 * rows) + localized toast; 409 INVALID_STATE → server refresh.
 */
export function OrdersPage() {
  const { t, locale } = useTranslation()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 10 })

  const { data, loading, error, refetch } = useResource(
    () => listOrders({ status: statusFilter === '' ? undefined : (statusFilter as OrderListItem['state']), page, limit }),
    [statusFilter, page, limit],
  )

  // R-UI-ORD-4: optimistic confirm — the row flips to confirmed while the
  // POST runs; the base state (server truth) replaces it on refetch, which
  // is exactly the rollback when the server still says draft.
  const [optimisticRows, addOptimistic] = useOptimistic(
    data?.data ?? [],
    (rows: OrderListItem[], orderId: string) =>
      rows.map((row) => (row.id === orderId ? { ...row, state: 'confirmed' as const } : row)),
  )

  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<OrderListItem | null>(null)

  async function handleConfirm(order: OrderListItem): Promise<void> {
    addOptimistic(order.id)
    try {
      await confirmOrder(order.id, crypto.randomUUID())
      showToast('success', t('notifications.type.orderConfirmed'))
      refetch()
    } catch (err) {
      // R-UI-ORD-4: order-specific localized messages for the atomic-confirm
      // conflicts (spec wording beats the generic error map here);
      // INSUFFICIENT_STOCK → rollback (refetch shows the still-draft row);
      // INVALID_STATE → refresh shows the server truth.
      const code = (err as { code?: string }).code
      const message =
        code === 'INSUFFICIENT_STOCK'
          ? t('orders.confirm.insufficient')
          : code === 'INVALID_STATE'
            ? t('orders.confirm.invalidState')
            : localizeError(err, t)
      showToast('error', message)
      refetch()
    }
  }

  async function handleCancelDone(): Promise<void> {
    setCancelling(null)
    refetch()
  }

  const columns: readonly Column<OrderListItem>[] = [
    { key: 'id', header: t('orders.id') },
    { key: 'customerId', header: t('orders.create.customer'), render: (row) => `#${row.customerId}` },
    {
      key: 'state',
      header: t('orders.state'),
      render: (row) => (
        <Badge tone={row.state === 'confirmed' ? 'success' : row.state === 'cancelled' ? 'neutral' : 'warning'}>
          {row.state === 'draft' ? t('orders.state.draft') : row.state === 'confirmed' ? t('orders.state.confirmed') : t('orders.state.cancelled')}
        </Badge>
      ),
    },
    { key: 'total', header: t('orders.total'), render: (row) => <MoneyText value={row.total} /> },
    { key: 'createdAt', header: t('orders.createdAt'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="row-actions">
          {row.state === 'draft' ? (
            <RoleGate permission="orders:order_confirm">
              <ConfirmButton label={t('orders.confirm.title')} onConfirm={() => handleConfirm(row)} />
            </RoleGate>
          ) : null}
          {row.state === 'draft' || row.state === 'confirmed' ? (
            <RoleGate permission="orders:order_cancel">
              <button type="button" className="btn btn-sm" onClick={() => setCancelling(row)}>
                {t('orders.cancel.title')}
              </button>
            </RoleGate>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>{t('orders.list.title')}</h1>
        <RoleGate permission="orders:order_create">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            {t('orders.create.title')}
          </button>
        </RoleGate>
      </div>

      <div className="filters">
        <Select
          aria-label={t('orders.state')}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            resetPage()
          }}
        >
          <option value="">{t('common.all')}</option>
          <option value="draft">{t('orders.state.draft')}</option>
          <option value="confirmed">{t('orders.state.confirmed')}</option>
          <option value="cancelled">{t('orders.state.cancelled')}</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={optimisticRows}
        keyOf={(row) => row.id}
        loading={loading}
        error={error ? localizeError(error, t) : null}
        onRetry={refetch}
      />
      {data && data.pagination.totalPages > 1 ? (
        <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
      ) : null}

      {creating ? (
        <Modal title={t('orders.create.title')} onClose={() => setCreating(false)}>
          <CreateOrderForm
            onDone={() => {
              setCreating(false)
              refetch()
            }}
          />
        </Modal>
      ) : null}

      {cancelling ? (
        <Modal title={t('orders.cancel.title')} onClose={() => setCancelling(null)}>
          <CancelOrderModal orderId={cancelling.id} onDone={() => void handleCancelDone()} />
        </Modal>
      ) : null}
    </div>
  )
}