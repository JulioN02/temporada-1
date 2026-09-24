/**
 * T-4-5..T-4-8 (capstone-ui it4) — Orders page + detail tests (R-UI-ORD-1..5).
 * RED: imports OrdersPage / OrderDetailPage / modules/orders/* — the page
 * logic (confirm with useOptimistic rollback, cancel with reason gate, create
 * line editor) does not exist yet. Mock fetch is the single seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { OrdersPage } from '../src/pages/OrdersPage.tsx'
import { OrderDetailPage } from '../src/pages/OrderDetailPage.tsx'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import {
  customerFixture,
  loginResponseFixture,
  orderFixture,
  orderListItemFixture,
  productFixture,
} from './__fixtures__/api.ts'
import type { Order, OrderListItem } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

const draft = orderListItemFixture({ id: '50', customerId: '10', state: 'draft', total: '3.00' })
const confirmed = orderListItemFixture({ id: '51', customerId: '10', state: 'confirmed', total: '12.50' })
const cancelled = orderListItemFixture({ id: '52', customerId: '11', state: 'cancelled', total: '0.50' })

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderOrders() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/orders']}>
            <OrdersPage />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

function renderDetail(id = '50') {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[`/orders/${id}`]}>
            <Routes>
              <Route path="/orders/:id" element={<OrderDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/** Wait until the orders table shows `count` rows (header included). */
async function waitForTableRows(count: number): Promise<HTMLElement[]> {
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(count), { timeout: 5000 })
  return screen.getAllByRole('row')
}

interface OrderMockState {
  orders: OrderListItem[]
  details: Map<string, Order>
}

/** Stateful orders mock: list filters/pagination, detail, create/confirm/cancel. */
function ordersMock(
  seed: OrderListItem[] = [draft, confirmed, cancelled],
  conflictIds: ReadonlySet<string> = new Set(['50']),
  invalidStateIds: ReadonlySet<string> = new Set(),
) {
  const state: OrderMockState = {
    orders: seed.map((o) => ({ ...o })),
    details: new Map([
      [draft.id, orderFixture({ id: draft.id, customerId: draft.customerId, state: 'draft', total: '3.00' })],
      [confirmed.id, orderFixture({ id: confirmed.id, customerId: confirmed.customerId, state: 'confirmed', total: '12.50' })],
      [cancelled.id, orderFixture({ id: cancelled.id, customerId: cancelled.customerId, state: 'cancelled', total: '0.50' })],
    ]),
  }
  const createKeys = new Map<string, Order>()

  const syncDetail = (item: OrderListItem): void => {
    const existing = state.details.get(item.id)
    state.details.set(item.id, orderFixture({ ...(existing ?? {}), id: item.id, state: item.state, total: item.total }))
  }
  const listResponse = (url: URL) => {
    const status = url.searchParams.get('status')
    const page = Number(url.searchParams.get('page') ?? '1')
    const limit = Number(url.searchParams.get('limit') ?? '10')
    const filtered = status ? state.orders.filter((o) => o.state === status) : state.orders
    const total = filtered.length
    return {
      status: 200,
      body: { data: filtered.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } },
    }
  }

  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/customers')) {
      return {
        status: 200,
        body: { data: [customerFixture()], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } },
      }
    }
    if (req.method === 'GET' && req.path.startsWith('/api/products')) {
      return {
        status: 200,
        body: { data: [productFixture()], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } },
      }
    }
    if (req.method === 'GET' && req.path.startsWith('/api/orders?')) {
      return listResponse(new URL(req.path, 'http://localhost'))
    }
    if (req.method === 'GET' && req.path.startsWith('/api/orders/')) {
      const id = req.path.split('/').pop()
      const order = state.details.get(String(id))
      if (!order) return { status: 404, body: err('NOT_FOUND') }
      return { status: 200, body: { order } }
    }
    if (req.method === 'POST' && req.path === '/api/orders') {
      const key = req.headers.get('idempotency-key') ?? null
      if (key && createKeys.has(key)) {
        const original = createKeys.get(key)!
        return { status: 200, body: { order: original } } // R-ORD-4 replay
      }
      const body = req.body as { customerId: string; lines: { productId: string; qty: number; unitPrice: string }[] }
      if (body.customerId !== '10') return { status: 422, body: err('VALIDATION_ERROR') }
      const order: Order = orderFixture({ id: '99', customerId: body.customerId, state: 'draft', total: '5.00' })
      if (key) createKeys.set(key, order)
      state.orders.unshift(orderListItemFixture({ id: order.id, customerId: order.customerId, state: 'draft', total: order.total }))
      state.details.set(order.id, order)
      return { status: 201, body: { order } }
    }
    if (req.method === 'POST' && req.path.match(/^\/api\/orders\/\d+\/confirm$/)) {
      const id = req.path.split('/')[3] ?? ''
      const item = state.orders.find((o) => o.id === id)
      if (!item) return { status: 404, body: err('NOT_FOUND') }
      if (item.state === 'confirmed') return { status: 409, body: err('INVALID_STATE') }
      if (invalidStateIds.has(item.id)) return { status: 409, body: err('INVALID_STATE') }
      if (conflictIds.has(item.id)) return { status: 409, body: err('INSUFFICIENT_STOCK') } // seeded conflict
      item.state = 'confirmed'
      syncDetail(item)
      return { status: 200, body: { order: state.details.get(id) } }
    }
    if (req.method === 'POST' && req.path.match(/^\/api\/orders\/\d+\/cancel$/)) {
      const id = req.path.split('/')[3] ?? ''
      const item = state.orders.find((o) => o.id === id)
      if (!item) return { status: 404, body: err('NOT_FOUND') }
      if (item.state === 'cancelled' || item.state === 'confirmed') {
        // confirmed can cancel; only cancelled is invalid
        if (item.state === 'cancelled') return { status: 409, body: err('INVALID_STATE') }
      }
      item.state = 'cancelled'
      syncDetail(item)
      return { status: 200, body: { order: state.details.get(id) } }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
  return state
}

/* ── R-UI-ORD-1: list + filter + badges + per-state actions ──────────── */

describe('R-UI-ORD-1: orders list', () => {
  it('R-UI-ORD-1: renders id/customer/total; localized state badges (Borrador/Confirmada/Cancelada)', async () => {
    ordersMock()
    renderOrders()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Borrador')).toBeInTheDocument()
    expect(within(table).getByText('Confirmada')).toBeInTheDocument()
    expect(within(table).getByText('Cancelada')).toBeInTheDocument()
    expect(within(table).getByText('3,00 €')).toBeInTheDocument() // D13 es formatting
    expect(within(table).getByText('12,50 €')).toBeInTheDocument()
  })

  it('R-UI-ORD-1: status=confirmed filter → only confirmed rows', async () => {
    ordersMock()
    renderOrders()
    await screen.findByRole('table')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Estado'), 'confirmed')
    await waitFor(() => {
      const table = screen.getByRole('table')
      expect(within(table).queryByText('Borrador')).toBeNull()
      expect(within(table).getAllByText('Confirmada')).toHaveLength(1)
      expect(within(table).queryByText('Cancelada')).toBeNull()
    })
    const filtered = mock.requests.find((r) => r.path.includes('status=confirmed'))
    expect(filtered).toBeTruthy()
  })

  it('R-UI-ORD-1: actions per state — draft: Confirm + Cancel; confirmed: Cancel only; cancelled: none', async () => {
    ordersMock()
    renderOrders()
    await screen.findByRole('table')
    // draft row (id 50) has both Confirm and Cancel
    const draftRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Borrador'))
    expect(draftRow).toBeTruthy()
    expect(within(draftRow as HTMLElement).getByRole('button', { name: /Confirmar/ })).toBeInTheDocument()
    expect(within(draftRow as HTMLElement).getByRole('button', { name: /Cancelar/ })).toBeInTheDocument()
    // confirmed row: Cancel only
    const confirmedRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Confirmada'))
    expect(confirmedRow).toBeTruthy()
    expect(within(confirmedRow as HTMLElement).queryByRole('button', { name: /Confirmar/ })).toBeNull()
    expect(within(confirmedRow as HTMLElement).getByRole('button', { name: /Cancelar/ })).toBeInTheDocument()
    // cancelled row: no actions
    const cancelledRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Cancelada'))
    expect(cancelledRow).toBeTruthy()
    expect(within(cancelledRow as HTMLElement).queryAllByRole('button')).toHaveLength(0)
  })
})

/* ── R-UI-ORD-2: detail with lines + D13 totals ──────────────────────── */

describe('R-UI-ORD-2: order detail', () => {
  it('R-UI-ORD-2: renders lines, qty, unitPrice and total from the API D13 strings', async () => {
    const state = ordersMock()
    state.details.set('50', orderFixture({ id: '50', customerId: '10', state: 'draft', total: '3.00' }))
    renderDetail('50')
    expect(await screen.findByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('1,50 €')).toBeInTheDocument() // unit price
    expect(screen.getAllByText('3,00 €')).toHaveLength(2) // line total + order total
    expect(screen.getByText('Borrador')).toBeInTheDocument()
  })

  it('R-UI-ORD-2: unknown id → localized 404 state with a back link, no crash', async () => {
    ordersMock()
    renderDetail('9999')
    expect(await screen.findByText('Pedido no encontrado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Volver/ })).toBeInTheDocument()
  })
})

/* ── R-UI-ORD-3: create order with dynamic line editor ──────────────── */

describe('R-UI-ORD-3: create order', () => {
  it('R-UI-ORD-3: unitPrice scale > 2 → localized line error, NO request', async () => {
    ordersMock()
    renderOrders()
    await screen.findByText('Borrador')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }))
    await screen.findByRole('option', { name: 'Ana Ruiz' }) // customer select loaded
    await user.selectOptions(screen.getByLabelText('Cliente'), '10')
    await screen.findByRole('option', { name: 'Widget' }) // product select loaded
    await user.selectOptions(screen.getAllByLabelText('Producto')[0] as HTMLElement, '20')
    await user.type(screen.getAllByLabelText('Cantidad')[0] as HTMLElement, '1')
    await user.type(screen.getAllByLabelText('Precio unitario')[0] as HTMLElement, '0,001') // es decimal comma → scale 3
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El precio admite como máximo 2 decimales')).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/orders')).toHaveLength(0)
  })

  it('R-UI-ORD-3: zero lines → localized "al menos una línea", NO request', async () => {
    ordersMock()
    renderOrders()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Crear pedido' }))
    await screen.findByRole('option', { name: 'Ana Ruiz' })
    await user.selectOptions(screen.getByLabelText('Cliente'), '10')
    await user.click(screen.getByRole('button', { name: 'Quitar línea' })) // empty the line list
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El pedido debe tener al menos una línea')).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/orders')).toHaveLength(0)
  })

  it('R-UI-ORD-3: two valid lines (es "12,50" → payload "12.50") → 201, draft row appears, toast', async () => {
    ordersMock()
    renderOrders()
    await screen.findByText('Borrador')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }))
    await screen.findByRole('option', { name: 'Ana Ruiz' }) // customer select loaded
    await user.selectOptions(screen.getByLabelText('Cliente'), '10')
    // line 1
    await screen.findByRole('option', { name: 'Widget' }) // product select loaded
    await user.selectOptions(screen.getAllByLabelText('Producto')[0] as HTMLElement, '20')
    await user.type(screen.getAllByLabelText('Cantidad')[0] as HTMLElement, '2')
    await user.type(screen.getAllByLabelText('Precio unitario')[0] as HTMLElement, '1,50')
    // line 2
    await user.click(screen.getByRole('button', { name: 'Agregar línea' }))
    await user.selectOptions(screen.getAllByLabelText('Producto')[1] as HTMLElement, '20')
    await user.type(screen.getAllByLabelText('Cantidad')[1] as HTMLElement, '1')
    await user.type(screen.getAllByLabelText('Precio unitario')[1] as HTMLElement, '2,00')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Pedido creado')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/orders')
    expect(post?.headers.get('idempotency-key')).toBeTruthy()
    expect(post?.body).toEqual({
      customerId: '10',
      lines: [
        { productId: '20', qty: 2, unitPrice: '1.50' },
        { productId: '20', qty: 1, unitPrice: '2.00' },
      ],
    })
  })

  it('R-UI-ORD-3: same-key replay (double submit) → exactly ONE order (replay 200)', async () => {
    const state = ordersMock()
    renderOrders()
    await screen.findByText('Borrador')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }))
    await screen.findByRole('option', { name: 'Ana Ruiz' }) // customer select loaded
    await user.selectOptions(screen.getByLabelText('Cliente'), '10')
    await screen.findByRole('option', { name: 'Widget' }) // product select loaded
    await user.selectOptions(screen.getAllByLabelText('Producto')[0] as HTMLElement, '20')
    await user.type(screen.getAllByLabelText('Cantidad')[0] as HTMLElement, '1')
    await user.type(screen.getAllByLabelText('Precio unitario')[0] as HTMLElement, '1,00')
    const save = screen.getByRole('button', { name: 'Guardar' })
    await user.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 })

    const posts = mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/orders')
    expect(posts).toHaveLength(1) // the UI disables the button while pending — one submit
    const created = state.orders.filter((o) => o.id === '99')
    expect(created).toHaveLength(1)
  })
})

/* ── R-UI-ORD-4: confirm order (optimistic, atomic 409 clean) ────────── */

describe('R-UI-ORD-4: confirm order', () => {
  it('R-UI-ORD-4: happy path — draft → confirmed + toast', async () => {
    ordersMock([draft, confirmed, cancelled], new Set()) // no conflicts → confirm succeeds
    renderOrders()
    await screen.findByText('Borrador')
    const user = userEvent.setup()
    const draftRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Borrador'))
    expect(draftRow).toBeTruthy()
    await user.click(within(draftRow as HTMLElement).getAllByRole('button', { name: /Confirmar/ })[0] as HTMLElement)
    await user.click(within(draftRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Borrador')).toBeNull(), { timeout: 5000 })
    expect(within(screen.getByRole('table')).getAllByText('Confirmada')).toHaveLength(2) // confirmed + the just-confirmed draft
    expect(await screen.findByText('Pedido confirmado')).toBeInTheDocument() // toast
    const confirmReq = mock.requests.find((r) => r.method === 'POST' && r.path.endsWith('/confirm'))
    expect(confirmReq?.headers.get('idempotency-key')).toBeTruthy()
  })

  it('R-UI-ORD-4: insufficient stock → localized 409, order stays draft, NO order_out movements', async () => {
    ordersMock()
    renderOrders()
    const rows = await waitForTableRows(4)
    const user = userEvent.setup()
    const draftRow = rows.find((row) => within(row).queryByText('Borrador'))
    await user.click(within(draftRow as HTMLElement).getAllByRole('button', { name: /Confirmar/ })[0] as HTMLElement)
    await user.click(within(draftRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Stock insuficiente para confirmar el pedido')).toBeInTheDocument()
    // optimistic rollback: row still shows Borrador (server truth)
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Borrador')).toBeInTheDocument(), { timeout: 5000 })
    // zero order_out rows — the UI never issued any stock mutation
    const stockMutations = mock.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/api/stock'))
    expect(stockMutations).toHaveLength(0)
  })

  it('R-UI-ORD-4: already confirmed elsewhere (409 INVALID_STATE) → localized + row refreshes from the server', async () => {
    // draft 50 is confirmed concurrently (server-side) between gate-open and confirm
    const state = ordersMock([draft, confirmed, cancelled], new Set(), new Set(['50']))
    renderOrders()
    await screen.findByText('Borrador')
    const user = userEvent.setup()
    const draftRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Borrador'))
    await user.click(within(draftRow as HTMLElement).getAllByRole('button', { name: /Confirmar/ })[0] as HTMLElement)
    // server flips the order to confirmed before the confirm lands
    const item = state.orders.find((o) => o.id === '50')
    if (item) item.state = 'confirmed'
    state.details.set('50', orderFixture({ id: '50', customerId: '10', state: 'confirmed', total: '3.00' }))
    await user.click(within(draftRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('El pedido ya no está en borrador; se actualizó el estado')).toBeInTheDocument()
    // server refresh: the row now shows Confirmada (server truth)
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Borrador')).toBeNull(), { timeout: 5000 })
    expect(within(screen.getByRole('table')).getAllByText('Confirmada')).toHaveLength(2)
  })

  it('R-UI-ORD-4: confirm gate — cancel fires NO request', async () => {
    ordersMock()
    renderOrders()
    const rows = await waitForTableRows(4)
    const user = userEvent.setup()
    const draftRow = rows.find((row) => within(row).queryByText('Borrador'))
    await user.click(within(draftRow as HTMLElement).getAllByRole('button', { name: /Confirmar/ })[0] as HTMLElement)
    await user.click(within(draftRow as HTMLElement).getByRole('button', { name: 'Cancelar' }))
    const confirms = mock.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/confirm'))
    expect(confirms).toHaveLength(0)
  })
})

/* ── R-UI-ORD-5: cancel order with reason ────────────────────────────── */

describe('R-UI-ORD-5: cancel order', () => {
  it('R-UI-ORD-5: short reason → localized client block, NO request', async () => {
    ordersMock()
    renderOrders()
    const rows = await waitForTableRows(4)
    const user = userEvent.setup()
    const draftRow = rows.find((row) => within(row).queryByText('Borrador'))
    await user.click(within(draftRow as HTMLElement).getAllByRole('button', { name: /Cancelar/ })[0] as HTMLElement)
    await user.type(screen.getByLabelText('Motivo de cancelación'), 'x')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El motivo debe tener al menos 10 caracteres')).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/cancel'))).toHaveLength(0)
  })

  it('R-UI-ORD-5: cancel with valid reason → cancelled + toast; stock levels NOT touched', async () => {
    const state = ordersMock()
    renderOrders()
    await screen.findByText('Borrador')
    const user = userEvent.setup()
    const draftRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Borrador'))
    await user.click(within(draftRow as HTMLElement).getAllByRole('button', { name: /Cancelar/ })[0] as HTMLElement)
    await user.type(screen.getByLabelText('Motivo de cancelación'), 'El cliente canceló la compra')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Pedido cancelado')).toBeInTheDocument() // toast
    await waitFor(() => {
      const cancel = mock.requests.find((r) => r.method === 'POST' && r.path.endsWith('/cancel'))
      expect(cancel?.body).toEqual({ reason: 'El cliente canceló la compra' })
    })
    // stock untouched — the UI sent NO stock mutation for the cancel
    const stockMutations = mock.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/api/stock'))
    expect(stockMutations).toHaveLength(0)
    const item = state.orders.find((o) => o.id === '50')
    expect(item?.state).toBe('cancelled')
  })
})