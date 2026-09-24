import { useParams, Link } from 'react-router-dom'
import { getOrder } from '../api/orders.ts'
import { useResource } from '../hooks/useResource.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { Badge } from '../components/Badge.tsx'
import { MoneyText } from '../components/MoneyText.tsx'
import { LoadingState } from '../components/LoadingState.tsx'
import { EmptyState } from '../components/EmptyState.tsx'

/**
 * Order detail (it4 T-4-5 — R-UI-ORD-2). GET /api/orders/:id → order +
 * lines; money rendered from the API D13 strings via MoneyText (per-locale,
 * float-free). Unknown id → localized not-found state with a back link.
 */
export function OrderDetailPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const { data, loading, error } = useResource(() => getOrder(id ?? ''), [id])

  if (loading) return <LoadingState />
  if (error) {
    const message = (error as { code?: string }).code === 'NOT_FOUND' ? t('orders.detail.notFound') : localizeError(error, t)
    return (
      <div className="page">
        <p className="form-error" role="alert">
          {message}
        </p>
        <Link to="/orders" className="link">
          {t('common.back')}
        </Link>
      </div>
    )
  }
  if (!data) return <EmptyState />

  const order = data.order
  return (
    <div className="page">
      <Link to="/orders" className="link">
        {t('common.back')}
      </Link>
      <h1>
        {t('orders.list.title')} #{order.id}
      </h1>
      <div className="detail-meta">
        <Badge tone={order.state === 'confirmed' ? 'success' : order.state === 'cancelled' ? 'neutral' : 'warning'}>
          {order.state === 'draft' ? t('orders.state.draft') : order.state === 'confirmed' ? t('orders.state.confirmed') : t('orders.state.cancelled')}
        </Badge>
        <span>
          {t('orders.create.customer')}: #{order.customerId}
        </span>
        <span>
          {t('orders.createdAt')}: {formatDateTime(order.createdAt, locale)}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('orders.create.product')}</th>
            <th>{t('orders.create.qty')}</th>
            <th>{t('orders.create.unitPrice')}</th>
            <th>{t('orders.create.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.productName}</td>
              <td>{line.qty}</td>
              <td>
                <MoneyText value={line.unitPrice} />
              </td>
              <td>
                <MoneyText value={line.lineTotal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="order-total">
        {t('orders.total')}: <MoneyText value={order.total} />
      </p>
    </div>
  )
}