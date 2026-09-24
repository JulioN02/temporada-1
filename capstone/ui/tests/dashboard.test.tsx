/**
 * T-3-1 (capstone-ui it3) — Dashboard page tests (R-UI-DSH-1..4).
 * RED: imports DashboardPage + deriveLowStock + api/status — none exist yet.
 * Mock fetch is the single seam — no live backend (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { DashboardPage } from '../src/pages/DashboardPage.tsx'
import { deriveLowStock } from '../src/modules/dashboard/lowStock.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture, notificationFixture, productFixture, stockRowFixture } from './__fixtures__/api.ts'
import type { StockRow } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderDashboard() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter>
            <DashboardPage />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/** Dashboard responder with knobs; asserts the requests it must serve. */
function dashboardMock({
  statusDb = 'up',
  statusStatus = 200,
  statusVersion = '1.0.0',
  kpiCustomers = 25,
  kpiProducts = 8,
  kpiOrders = 14,
  stockItems = [stockRowFixture({ level: '10' })],
  thresholds = [productFixture({ lowStockThreshold: 5 })],
  unreadNotifications = [notificationFixture()],
}: {
  statusDb?: 'up' | 'down'
  statusStatus?: number
  statusVersion?: string
  kpiCustomers?: number
  kpiProducts?: number
  kpiOrders?: number
  stockItems?: StockRow[]
  thresholds?: ReturnType<typeof productFixture>[]
  unreadNotifications?: ReturnType<typeof notificationFixture>[]
} = {}): void {
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.path === '/api/status') {
      return statusStatus === 200
        ? {
            status: 200,
            body: {
              version: statusVersion,
              uptimeSeconds: 3600,
              db: statusDb,
              timestamp: '2026-01-01T00:00:00.000Z',
              queues: 'up',
            },
          }
        : { status: statusStatus, body: err('INTERNAL_ERROR') }
    }
    if (req.path === '/api/health') {
      return statusStatus === 200
        ? { status: 200, body: { status: 'ok', db: statusDb } }
        : { status: statusStatus, body: { status: 'degraded', db: 'down' } }
    }
    if (req.path === '/api/customers?limit=1') {
      return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: kpiCustomers, totalPages: kpiCustomers } } }
    }
    if (req.path === '/api/products?limit=1') {
      return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: kpiProducts, totalPages: kpiProducts } } }
    }
    if (req.path === '/api/orders?limit=1') {
      return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: kpiOrders, totalPages: kpiOrders } } }
    }
    if (req.path === '/api/products?limit=100') {
      return { status: 200, body: { data: thresholds, pagination: { page: 1, limit: 100, total: thresholds.length, totalPages: 1 } } }
    }
    if (req.path === '/api/stock') {
      return { status: 200, body: { items: stockItems } }
    }
    if (req.path === '/api/notifications?unreadOnly=true&limit=5') {
      return {
        status: 200,
        body: {
          data: unreadNotifications,
          pagination: { page: 1, limit: 5, total: unreadNotifications.length, totalPages: 1 },
        },
      }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

/* ── R-UI-DSH-1: status + KPI cards ──────────────────────────────────── */

describe('R-UI-DSH-1: status + KPI cards', () => {
  it('R-UI-DSH-1: admin KPIs — 25 customers, 8 products, 14 orders + status ok + version', async () => {
    dashboardMock()
    renderDashboard()
    expect(await screen.findByText('25')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('Operativo')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Estado del sistema' })).toBeInTheDocument()
    // three KPI labels
    expect(screen.getByText('Clientes')).toBeInTheDocument()
    expect(screen.getByText('Productos')).toBeInTheDocument()
    expect(screen.getByText('Pedidos')).toBeInTheDocument()
  })

  it('R-UI-DSH-1: partial failure — GET /api/status 503s → status card degraded, count cards still render', async () => {
    dashboardMock({ statusStatus: 503, kpiCustomers: 3 })
    renderDashboard()
    // degraded status card (localized) + retry
    expect(await screen.findByText('Degradado')).toBeInTheDocument()
    // count cards unaffected
    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
  })

  it('R-UI-DSH-1: db down (200 with db:"down") → degraded state, not ok', async () => {
    dashboardMock({ statusDb: 'down' })
    renderDashboard()
    expect(await screen.findByText('Degradado')).toBeInTheDocument()
    expect(screen.queryByText('Operativo')).toBeNull()
  })
})

/* ── R-UI-DSH-2: low-stock alert card ────────────────────────────────── */

describe('R-UI-DSH-2: low-stock alert card', () => {
  it('R-UI-DSH-2: product threshold 5 level 3 → listed with level 3 / threshold 5', async () => {
    dashboardMock({
      stockItems: [stockRowFixture({ product_id: '20', sku: 'WID-1', name: 'Widget', level: '3' })],
      thresholds: [productFixture({ lowStockThreshold: 5 })],
    })
    renderDashboard()
    expect(await screen.findByText('Widget · WID-1 · 3/5')).toBeInTheDocument()
  })

  it('R-UI-DSH-2: all levels above thresholds → "Sin alertas de stock bajo"', async () => {
    dashboardMock({
      stockItems: [stockRowFixture({ level: '10' })],
      thresholds: [productFixture({ lowStockThreshold: 5 })],
    })
    renderDashboard()
    expect(await screen.findByText('Sin alertas de stock bajo')).toBeInTheDocument()
    expect(screen.queryByText(/· WID-1 ·/)).toBeNull()
  })
})

/* ── R-UI-DSH-3: recent unread notifications ─────────────────────────── */

describe('R-UI-DSH-3: recent notifications summary', () => {
  it('R-UI-DSH-3: 3 unread notifications render their stored titles + link to the notifications page', async () => {
    dashboardMock({
      unreadNotifications: [
        notificationFixture({ id: '1', title: 'Pedido confirmado' }),
        notificationFixture({ id: '2', title: 'Stock bajo', readAt: null }),
        notificationFixture({ id: '3', title: 'Stock ajustado', readAt: null }),
      ],
    })
    renderDashboard()
    const card = await screen.findByLabelText('Notificaciones recientes')
    expect(await within(card).findByText('Pedido confirmado')).toBeInTheDocument()
    expect(within(card).getByText('Stock bajo')).toBeInTheDocument()
    expect(within(card).getByText('Stock ajustado')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Notificaciones' })).toBeInTheDocument()
  })
})

/* ── R-UI-DSH-4: on-demand refresh (stale-while-revalidating) ────────── */

describe('R-UI-DSH-4: refresh control', () => {
  it('R-UI-DSH-4: click refresh → all cards re-fetch (2nd round of calls) and update', async () => {
    let kpiCalls = 0
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
      if (req.path === '/api/status') {
        return { status: 200, body: { version: '1.0.0', uptimeSeconds: 1, db: 'up', timestamp: 'x', queues: 'up' } }
      }
      if (req.path === '/api/health') return { status: 200, body: { status: 'ok', db: 'up' } }
      if (req.path === '/api/customers?limit=1') {
        kpiCalls += 1
        return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: kpiCalls === 1 ? 25 : 30, totalPages: 30 } } }
      }
      if (req.path === '/api/products?limit=1') {
        return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: 8, totalPages: 8 } } }
      }
      if (req.path === '/api/orders?limit=1') {
        return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: 14, totalPages: 14 } } }
      }
      if (req.path === '/api/products?limit=100') {
        return { status: 200, body: { data: [productFixture()], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } } }
      }
      if (req.path === '/api/stock') return { status: 200, body: { items: [stockRowFixture()] } }
      if (req.path === '/api/notifications?unreadOnly=true&limit=5') {
        return { status: 200, body: { data: [notificationFixture()], pagination: { page: 1, limit: 5, total: 1, totalPages: 1 } } }
      }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderDashboard()

    expect(await screen.findByText('25')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    expect(await screen.findByText('30')).toBeInTheDocument()
    expect(kpiCalls).toBe(2) // second round of calls
  })

  it('R-UI-DSH-4: failed re-fetch keeps previous values + error toast (stale-while-revalidating)', async () => {
    let kpiCalls = 0
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
      if (req.path === '/api/status') {
        return { status: 200, body: { version: '1.0.0', uptimeSeconds: 1, db: 'up', timestamp: 'x', queues: 'up' } }
      }
      if (req.path === '/api/health') return { status: 200, body: { status: 'ok', db: 'up' } }
      if (req.path === '/api/customers?limit=1') {
        kpiCalls += 1
        return kpiCalls === 1
          ? { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: 25, totalPages: 25 } } }
          : { status: 500, body: err('INTERNAL_ERROR') }
      }
      if (req.path === '/api/products?limit=1') {
        return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: 8, totalPages: 8 } } }
      }
      if (req.path === '/api/orders?limit=1') {
        return { status: 200, body: { data: [], pagination: { page: 1, limit: 1, total: 14, totalPages: 14 } } }
      }
      if (req.path === '/api/products?limit=100') {
        return { status: 200, body: { data: [productFixture()], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } } }
      }
      if (req.path === '/api/stock') return { status: 200, body: { items: [stockRowFixture()] } }
      if (req.path === '/api/notifications?unreadOnly=true&limit=5') {
        return { status: 200, body: { data: [notificationFixture()], pagination: { page: 1, limit: 5, total: 1, totalPages: 1 } } }
      }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderDashboard()

    expect(await screen.findByText('25')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    // previous value still visible (stale-while-revalidating)
    expect(await screen.findByText('25')).toBeInTheDocument()
    // error toast rendered
    await waitFor(() => expect(screen.getByText('Ocurrió un error al cargar los datos')).toBeInTheDocument())
  })
})

/* ── deriveLowStock pure helper (R-UI-DSH-2 core) ────────────────────── */

describe('deriveLowStock (R-UI-DSH-2)', () => {
  it('deriveLowStock: flags rows where level <= threshold, keeps level/threshold pairs', () => {
    const rows: StockRow[] = [
      stockRowFixture({ product_id: '1', name: 'A', sku: 'A1', level: '3' }),
      stockRowFixture({ product_id: '2', name: 'B', sku: 'B1', level: '5' }),
      stockRowFixture({ product_id: '3', name: 'C', sku: 'C1', level: '6' }),
    ]
    const thresholds = new Map([
      ['1', 5],
      ['2', 5],
      ['3', 2],
    ])
    const alerts = deriveLowStock(rows, thresholds)
    expect(alerts).toHaveLength(2) // A (3<=5) and B (5<=5, equal counts) — C (6>2) not
    expect(alerts[0]).toMatchObject({ productId: '1', level: '3', threshold: 5 })
    expect(alerts[1]).toMatchObject({ productId: '2', level: '5', threshold: 5 })
  })

  it('deriveLowStock: rows with unknown threshold are NOT flagged (cannot prove low)', () => {
    const rows: StockRow[] = [stockRowFixture({ product_id: '99', level: '1' })]
    const alerts = deriveLowStock(rows, new Map())
    expect(alerts).toHaveLength(0)
  })
})