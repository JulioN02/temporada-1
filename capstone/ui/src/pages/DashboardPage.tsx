import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getHealth, getStatus } from '../api/status.ts'
import { listCustomers } from '../api/customers.ts'
import { listProducts } from '../api/products.ts'
import { listOrders } from '../api/orders.ts'
import { listNotifications } from '../api/notifications.ts'
import { getStock } from '../api/stock.ts'
import type { Notification } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { Badge } from '../components/Badge.tsx'
import { LoadingState } from '../components/LoadingState.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { showToast } from '../components/ToastProvider.tsx'
import { deriveLowStock } from '../modules/dashboard/lowStock.ts'

/**
 * Dashboard (it3 T-3-1 — R-UI-DSH-1..4): status card, KPI cards
 * (limit=1 pagination.total), low-stock card (client-side level<=threshold),
 * recent unread notifications card, and an on-demand refresh that keeps
 * stale data visible when a re-fetch fails (R-UI-DSH-4). Every card fetches
 * independently — a failed card renders its own localized error/retry
 * without blocking the others (R-UI-DSH-1 partial failure).
 */

/** Shared card body rule: loading → error(no data) → empty → data. */
function CardBody<T>({
  loading,
  error,
  data,
  onRetry,
  render,
}: {
  loading: boolean
  error: unknown
  data: T | null
  onRetry: () => void
  render: (data: T) => ReactNode
}) {
  const { t } = useTranslation()
  if (loading) return <LoadingState />
  if (error && data === null) {
    return <ErrorState message={localizeError(error, t)} onRetry={onRetry} />
  }
  if (data === null) return <EmptyState />
  return render(data)
}

function KpiCard({ value }: { value: number }) {
  return (
    <div className="kpi-card">
      <span className="kpi-value">{value}</span>
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const [refreshTick, setRefreshTick] = useState(0)

  const status = useResource(async () => {
    const [system] = await Promise.all([getStatus(), getHealth()])
    return system
  }, [refreshTick])

  const kpiCustomers = useResource(async () => (await listCustomers({ limit: 1 })).pagination.total, [refreshTick])
  const kpiProducts = useResource(async () => (await listProducts({ limit: 1 })).pagination.total, [refreshTick])
  const kpiOrders = useResource(async () => (await listOrders({ limit: 1 })).pagination.total, [refreshTick])

  const lowStock = useResource(async () => {
    const [stock, products] = await Promise.all([getStock(), listProducts({ limit: 100 })])
    const thresholds = new Map(products.data.map((p) => [p.id, p.lowStockThreshold] as const))
    return deriveLowStock(stock.items, thresholds)
  }, [refreshTick])

  const recent = useResource(async () => (await listNotifications({ unreadOnly: true, limit: 5 })).data, [refreshTick])

  // R-UI-DSH-4: a failed re-fetch keeps the stale values on screen and
  // surfaces an error toast once per refresh attempt.
  const hasRefreshError = Boolean(
    refreshTick > 0 && (status.error || kpiCustomers.error || kpiProducts.error || kpiOrders.error || lowStock.error || recent.error),
  )
  useEffect(() => {
    if (hasRefreshError) showToast('error', t('common.errorRetry'))
  }, [refreshTick, hasRefreshError, t])

  function refresh(): void {
    setRefreshTick((current) => current + 1)
  }

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <h1>{t('nav.dashboard')}</h1>
        <button type="button" className="btn" onClick={refresh}>
          {t('dashboard.refresh')}
        </button>
      </div>

      <div className="dashboard-grid">
        {/* Status card (R-UI-DSH-1) */}
        <section className="card" aria-label={t('dashboard.status.title')}>
          <h2>{t('dashboard.status.title')}</h2>
          {status.loading ? (
            <LoadingState />
          ) : status.data === null ? (
            // R-UI-DSH-1 partial failure: an unreachable status endpoint
            // renders the DEGRADED state (never a fake "ok") + localized error + retry.
            <div className="status-body">
              <Badge tone="danger">{t('dashboard.status.degraded')}</Badge>
              <ErrorState message={localizeError(status.error, t)} onRetry={status.refetch} />
            </div>
          ) : (
            <div className="status-body">
              <Badge tone={status.data.db === 'up' ? 'success' : 'danger'}>
                {status.data.db === 'up' ? t('dashboard.status.ok') : t('dashboard.status.degraded')}
              </Badge>
              <dl className="status-details">
                <dt>{t('orders.id')}</dt>
                <dd>{status.data.version}</dd>
                <dt>{t('orders.state')}</dt>
                <dd>{status.data.db}</dd>
              </dl>
            </div>
          )}
        </section>

        {/* KPI cards (R-UI-DSH-1) */}
        <section className="card" aria-label={t('dashboard.kpi.customers')}>
          <h2>{t('dashboard.kpi.customers')}</h2>
          <CardBody
            loading={kpiCustomers.loading}
            error={kpiCustomers.error}
            data={kpiCustomers.data}
            onRetry={kpiCustomers.refetch}
            render={(value: number) => <KpiCard value={value} />}
          />
        </section>
        <section className="card" aria-label={t('dashboard.kpi.products')}>
          <h2>{t('dashboard.kpi.products')}</h2>
          <CardBody
            loading={kpiProducts.loading}
            error={kpiProducts.error}
            data={kpiProducts.data}
            onRetry={kpiProducts.refetch}
            render={(value: number) => <KpiCard value={value} />}
          />
        </section>
        <section className="card" aria-label={t('dashboard.kpi.orders')}>
          <h2>{t('dashboard.kpi.orders')}</h2>
          <CardBody
            loading={kpiOrders.loading}
            error={kpiOrders.error}
            data={kpiOrders.data}
            onRetry={kpiOrders.refetch}
            render={(value: number) => <KpiCard value={value} />}
          />
        </section>

        {/* Low-stock alert card (R-UI-DSH-2) */}
        <section className="card" aria-label={t('dashboard.lowStock.title')}>
          <h2>{t('dashboard.lowStock.title')}</h2>
          <CardBody
            loading={lowStock.loading}
            error={lowStock.error}
            data={lowStock.data}
            onRetry={lowStock.refetch}
            render={(alerts: ReturnType<typeof deriveLowStock>) =>
              alerts.length === 0 ? (
                <EmptyState message={t('dashboard.lowStock.none')} />
              ) : (
                <ul className="alert-list">
                  {alerts.map((alert) => (
                    <li key={`${alert.productId}-${alert.warehouseName}`} className="alert-row">
                      <Badge tone="warning">{t('stock.levels.low')}</Badge>
                      <span>
                        {alert.name} · {alert.sku} · {alert.level}/{alert.threshold}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </section>

        {/* Recent unread notifications (R-UI-DSH-3) */}
        <section className="card" aria-label={t('dashboard.recentNotifications.title')}>
          <h2>{t('dashboard.recentNotifications.title')}</h2>
          <CardBody
            loading={recent.loading}
            error={recent.error}
            data={recent.data}
            onRetry={recent.refetch}
            render={(items: Notification[]) =>
              items.length === 0 ? (
                <EmptyState message={t('notifications.empty')} />
              ) : (
                <ul className="alert-list">
                  {items.map((item) => (
                    <li key={item.id} className="notification-row">
                      {item.title}
                    </li>
                  ))}
                </ul>
              )
            }
          />
          <Link to="/notifications" className="link">
            {t('nav.notifications')}
          </Link>
        </section>
      </div>
    </div>
  )
}