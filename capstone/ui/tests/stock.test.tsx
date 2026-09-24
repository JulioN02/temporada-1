/**
 * T-4-1..T-4-4 (capstone-ui it4) — Stock page tests (R-UI-STK-1..4).
 * RED: imports StockPage + modules/stock/{forms,AdjustForm,TransferForm} —
 * none exist yet. Levels stay strings (no float coercion); 409 conflicts
 * surface with ZERO visible side effects (cells unchanged). Mock fetch is
 * the single seam (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { StockPage } from '../src/pages/StockPage.tsx'
import { isLowStock } from '../src/modules/stock/forms.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture, productFixture, warehouseFixture } from './__fixtures__/api.ts'
import type { MovementListItem } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

const products = [
  productFixture({ id: '20', name: 'Widget', sku: 'WID-1', lowStockThreshold: 5 }),
  productFixture({ id: '21', name: 'Gadget', sku: 'GAD-2', lowStockThreshold: 2 }),
]
const warehouses = [
  warehouseFixture({ id: '30', name: 'Main WH' }),
  warehouseFixture({ id: '31', name: 'North WH' }),
]

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderStock() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <StockPage />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

interface StockLedgerState {
  /** `${productId}:${warehouseId}` → level */
  levels: Map<string, number>
  movements: MovementListItem[]
  nextMovementId: number
}

function movementRow(state: StockLedgerState, m: MovementListItem): void {
  state.movements.unshift(m)
}

/**
 * Stateful stock mock: GET /api/stock (derived levels), GET /api/stock/movements
 * (filters + pagination, newest-first), POST adjust (409 NEGATIVE_STOCK on
 * negative result, replay by key), POST transfers (409 on insufficient source).
 * `options.products` overrides the module fixture list (T-6-3 uses it to add an
 * inactive product). GET /api/stock mirrors the BACKEND contract (it1 verified,
 * #1433): rows whose product is inactive are EXCLUDED (`WHERE p.active = true`)
 * — the mock is contract-faithful, never the source of truth.
 */
function stockMock(
  seed: { productId: string; warehouseId: string; level: number }[],
  options: { products?: typeof products; warehouses?: typeof warehouses } = {},
) {
  const productList = options.products ?? products
  const warehouseList = options.warehouses ?? warehouses
  const state: StockLedgerState = { levels: new Map(), movements: [], nextMovementId: 1 }
  for (const row of seed) state.levels.set(`${row.productId}:${row.warehouseId}`, row.level)
  const keys = new Map<string, MovementListItem>()

  const currentLevel = (productId: string, warehouseId: string): number =>
    state.levels.get(`${productId}:${warehouseId}`) ?? 0

  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/products')) {
      return {
        status: 200,
        body: { data: products, pagination: { page: 1, limit: 100, total: products.length, totalPages: 1 } },
      }
    }
    if (req.method === 'GET' && req.path.startsWith('/api/warehouses')) {
      return {
        status: 200,
        body: { data: warehouses, pagination: { page: 1, limit: 100, total: warehouses.length, totalPages: 1 } },
      }
    }
    if (req.method === 'GET' && (req.path === '/api/stock' || req.path.startsWith('/api/stock?'))) {
      const url = new URL(req.path, 'http://localhost')
      const productId = url.searchParams.get('productId')
      const warehouseId = url.searchParams.get('warehouseId')
      const items = seed
        // backend contract (R-UI-CRM-5 / #1433): inactive products never
        // appear in GET /api/stock — the fixture models the served set
        .filter((r) => productList.find((p) => p.id === r.productId)?.active !== false)
        .filter((r) => (productId ? r.productId === productId : true))
        .filter((r) => (warehouseId ? r.warehouseId === warehouseId : true))
        .map((r) => {
          const product = productList.find((p) => p.id === r.productId)!
          const warehouse = warehouseList.find((w) => w.id === r.warehouseId)!
          return {
            product_id: r.productId,
            sku: product.sku,
            name: product.name,
            warehouse_id: r.warehouseId,
            warehouse_name: warehouse.name,
            level: String(currentLevel(r.productId, r.warehouseId)),
          }
        })
      return { status: 200, body: { items } }
    }
    if (req.method === 'GET' && req.path.startsWith('/api/stock/movements')) {
      const url = new URL(req.path, 'http://localhost')
      const type = url.searchParams.get('type')
      const productId = url.searchParams.get('productId')
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '10')
      let filtered = state.movements
      if (type) filtered = filtered.filter((m) => m.type === type)
      if (productId) filtered = filtered.filter((m) => m.productId === productId)
      const total = filtered.length
      const slice = filtered.slice((page - 1) * limit, page * limit)
      return {
        status: 200,
        body: { data: slice, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } },
      }
    }
    if (req.method === 'POST' && req.path === '/api/stock/movements') {
      const key = req.headers.get('idempotency-key') ?? null
      if (key && keys.has(key)) {
        const original = keys.get(key)!
        return { status: 200, body: { movement: original } } // R-STK-6 replay
      }
      const body = req.body as { productId: string; warehouseId: string; quantity: number; reason: string }
      const level = currentLevel(body.productId, body.warehouseId)
      const next = level + body.quantity
      if (next < 0) return { status: 409, body: err('NEGATIVE_STOCK') }
      state.levels.set(`${body.productId}:${body.warehouseId}`, next)
      const movement: MovementListItem = {
        id: String(state.nextMovementId++),
        productId: body.productId,
        warehouseId: body.warehouseId,
        type: 'adjustment',
        quantity: Math.abs(body.quantity),
        sign: body.quantity < 0 ? -1 : 1,
        reason: body.reason,
        idempotencyKey: key,
        createdAt: new Date().toISOString(),
        sku: products.find((p) => p.id === body.productId)?.sku ?? '',
        productName: products.find((p) => p.id === body.productId)?.name ?? '',
        warehouseName: warehouses.find((w) => w.id === body.warehouseId)?.name ?? '',
      }
      if (key) keys.set(key, movement)
      movementRow(state, movement)
      return { status: 201, body: { movement } }
    }
    if (req.method === 'POST' && req.path === '/api/stock/transfers') {
      const key = req.headers.get('idempotency-key') ?? null
      if (key && keys.has(key)) {
        const original = keys.get(key)!
        return { status: 200, body: { movement: original } }
      }
      const body = req.body as { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; reason: string }
      if (body.fromWarehouseId === body.toWarehouseId) {
        return { status: 422, body: err('VALIDATION_ERROR') }
      }
      const sourceLevel = currentLevel(body.productId, body.fromWarehouseId)
      if (sourceLevel < body.quantity) return { status: 409, body: err('NEGATIVE_STOCK') }
      state.levels.set(`${body.productId}:${body.fromWarehouseId}`, sourceLevel - body.quantity)
      state.levels.set(`${body.productId}:${body.toWarehouseId}`, currentLevel(body.productId, body.toWarehouseId) + body.quantity)
      const product = products.find((p) => p.id === body.productId)!
      const fromWh = warehouses.find((w) => w.id === body.fromWarehouseId)!
      const toWh = warehouses.find((w) => w.id === body.toWarehouseId)!
      const out: MovementListItem = {
        id: String(state.nextMovementId++),
        productId: body.productId,
        warehouseId: body.fromWarehouseId,
        type: 'transfer_out',
        quantity: body.quantity,
        sign: -1,
        reason: body.reason,
        idempotencyKey: key,
        createdAt: new Date().toISOString(),
        sku: product.sku,
        productName: product.name,
        warehouseName: fromWh.name,
      }
      const inn: MovementListItem = {
        ...out,
        id: String(state.nextMovementId++),
        warehouseId: body.toWarehouseId,
        type: 'transfer_in',
        sign: 1,
        idempotencyKey: null,
        warehouseName: toWh.name,
      }
      if (key) keys.set(key, out)
      movementRow(state, out)
      movementRow(state, inn)
      return { status: 201, body: { movement: out } }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

const twoByTwo = [
  { productId: '20', warehouseId: '30', level: 10 },
  { productId: '20', warehouseId: '31', level: 3 },
  { productId: '21', warehouseId: '30', level: 8 },
  { productId: '21', warehouseId: '31', level: 5 },
]

/* ── R-UI-STK-1: levels table ────────────────────────────────────────── */

describe('R-UI-STK-1: stock levels table', () => {
  it('R-UI-STK-1: 2 products × 2 warehouses → 4 rows render with string levels', async () => {
    stockMock(twoByTwo)
    renderStock()
    expect(await screen.findByRole('heading', { name: 'Niveles de stock' })).toBeInTheDocument()
    const rows = await screen.findAllByRole('row')
    // header + 4 data rows
    expect(rows).toHaveLength(5)
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Widget')).toHaveLength(2)
    expect(within(table).getAllByText('Gadget')).toHaveLength(2)
    expect(within(table).getAllByText('Main WH')).toHaveLength(2)
    expect(within(table).getAllByText('North WH')).toHaveLength(2)
    expect(within(table).getByText('10')).toBeInTheDocument() // string level
  })

  it('R-UI-STK-1: level "3" with threshold 5 → low badge (W20xW31); others above → no badge', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    // seed: W20xW30=10 (thr 5 → NOT low), W20xW31=3 (thr 5 → LOW),
    //       W21xW30=8 (thr 2 → NOT), W21xW31=5 (thr 2 → NOT)
    await waitFor(() => expect(screen.getAllByText('Stock bajo')).toHaveLength(1))
    expect(within(screen.getAllByRole('row')[2] as HTMLElement).getByText('Stock bajo')).toBeInTheDocument()
  })

  it('R-UI-STK-1: equal counts as low — level "5" threshold 5 shows the badge', async () => {
    stockMock([
      { productId: '20', warehouseId: '30', level: 5 },
      { productId: '20', warehouseId: '31', level: 6 },
    ])
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    await waitFor(() => expect(screen.getAllByText('Stock bajo').length).toBe(1)) // 5 <= 5 → low; 6 > 5 → not
  })

  it('R-UI-STK-1: warehouseId filter → only that warehouse rows render', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5))
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Filtrar por almacén'), '31')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3)) // header + 2 rows (North WH)
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('North WH')).toHaveLength(2)
    expect(within(table).queryAllByText('Main WH')).toHaveLength(0)
    // the request carried warehouseId=31
    const filtered = mock.requests.find((r) => r.path.includes('warehouseId=31'))
    expect(filtered).toBeTruthy()
  })
})

/* ── R-UI-STK-2: movements tab ───────────────────────────────────────── */

describe('R-UI-STK-2: movements history', () => {
  it('R-UI-STK-2: type=adjustment filter → only adjustment rows render', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    const user = userEvent.setup()

    // seed one adjustment while on the levels tab (the adjust button lives there)
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén'), '30')
    await user.type(screen.getByLabelText('Cantidad'), '2')
    await user.type(screen.getByLabelText('Motivo'), 'Ajuste de inventario inicial')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // now the movements tab
    await user.click(screen.getByRole('tab', { name: 'Movimientos' }))
    await screen.findByRole('heading', { name: 'Movimientos' })

    await user.selectOptions(screen.getByLabelText('Tipo de movimiento'), 'adjustment')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2)) // header + 1 adjustment row
    expect(screen.getByText('Ajuste de inventario inicial')).toBeInTheDocument()
  })

  it('R-UI-STK-2: pagination — page 2 loads the next batch', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    const user = userEvent.setup()
    // create 15 adjustments while on the levels tab
    for (let i = 0; i < 15; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Ajustar stock' }))
      await user.selectOptions(screen.getByLabelText('Producto'), '20')
      await user.selectOptions(screen.getByLabelText('Almacén'), '30')
      await user.type(screen.getByLabelText('Cantidad'), '1')
      await user.type(screen.getByLabelText('Motivo'), `Ajuste de inventario numero ${i}`)
      await user.click(screen.getByRole('button', { name: 'Guardar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 })
    }
    await user.click(screen.getByRole('tab', { name: 'Movimientos' }))
    await screen.findByRole('heading', { name: 'Movimientos' })
    await waitFor(() => expect(screen.getByText('Página 1 de 2')).toBeInTheDocument(), { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument()
  }, 30000)
})

/* ── R-UI-STK-3: adjust stock ────────────────────────────────────────── */

describe('R-UI-STK-3: adjust stock', () => {
  it('R-UI-STK-3: adjust up — level "10" + qty 5 → level cell updates to "15"', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén'), '30')
    await user.type(screen.getByLabelText('Cantidad'), '5')
    await user.type(screen.getByLabelText('Motivo'), 'Ajuste de inventario inicial')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 })
    await waitFor(() => expect(screen.getAllByText('15')).toHaveLength(1), { timeout: 5000 })
    const adj = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/stock/movements')
    expect(adj?.body).toMatchObject({ type: 'adjustment', productId: '20', warehouseId: '30', quantity: 5 })
    expect(adj?.headers.get('idempotency-key')).toBeTruthy()
  })

  it('R-UI-STK-3: qty −5 on level "3" → localized 409, level cell stays "3" (zero side effects)', async () => {
    stockMock(twoByTwo) // Widget/North (20:31) level 3
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén'), '31')
    await user.type(screen.getByLabelText('Cantidad'), '-5')
    await user.type(screen.getByLabelText('Motivo'), 'Ajuste de inventario inicial')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('La operación dejaría el stock en negativo')).toBeInTheDocument()
    // level cell unchanged — Widget/North still 3
    await waitFor(() => expect(screen.getAllByText('3')).toHaveLength(1))
    const movements = mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/stock/movements')
    expect(movements).toHaveLength(1) // the failed one — server returned 409, NO movement row created
  })

  it('R-UI-STK-3: qty 0 or reason "x" → localized client errors, NO request', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén'), '30')
    await user.type(screen.getByLabelText('Cantidad'), '0')
    await user.type(screen.getByLabelText('Motivo'), 'x')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('La cantidad debe ser un entero distinto de cero')).toBeInTheDocument()
    expect(screen.getByText('El motivo debe tener al menos 10 caracteres')).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/stock/movements')).toHaveLength(0)
  })

  it('R-UI-STK-3: 409 consumes the key — retry uses a NEW key, exactly ONE movement in history', async () => {
    stockMock(twoByTwo) // Widget/North (20:31) level 3
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ajustar stock' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén'), '31')
    await user.type(screen.getByLabelText('Cantidad'), '-5')
    await user.type(screen.getByLabelText('Motivo'), 'Ajuste de inventario inicial')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La operación dejaría el stock en negativo')).toBeInTheDocument()

    // fix the quantity and retry — the new attempt MUST use a NEW key
    await user.clear(screen.getByLabelText('Cantidad'))
    await user.type(screen.getByLabelText('Cantidad'), '-1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const posts = mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/stock/movements')
    expect(posts).toHaveLength(2) // failed 409 + successful retry
    const keys = new Set(posts.map((r) => r.headers.get('idempotency-key')))
    expect(keys.size).toBe(2) // NEW key after the 409 (old key consumed)

    await user.click(screen.getByRole('tab', { name: 'Movimientos' }))
    await screen.findByRole('heading', { name: 'Movimientos' })
    const rows = await screen.findAllByRole('row')
    expect(rows).toHaveLength(2) // header + exactly ONE movement (the success)
  })
})

/* ── R-UI-STK-4: transfer stock ──────────────────────────────────────── */

describe('R-UI-STK-4: transfer stock', () => {
  it('R-UI-STK-4: transfer 4 A→B — A "10"→"6", B "0"→"4", 2 ledger rows', async () => {
    stockMock([
      { productId: '20', warehouseId: '30', level: 10 },
      { productId: '20', warehouseId: '31', level: 0 },
    ])
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Transferir' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén origen'), '30')
    await user.selectOptions(screen.getByLabelText('Almacén destino'), '31')
    await user.type(screen.getByLabelText('Cantidad'), '4')
    await user.type(screen.getByLabelText('Motivo'), 'Traslado de mercadería entre bodegas')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // A shows 6, B shows 4
    await waitFor(() => expect(screen.getAllByText('6')).toHaveLength(1))
    expect(screen.getAllByText('4')).toHaveLength(1)
    // 2 ledger rows
    await user.click(screen.getByRole('tab', { name: 'Movimientos' }))
    await screen.findByRole('heading', { name: 'Movimientos' })
    const rows = await screen.findAllByRole('row')
    expect(rows).toHaveLength(3) // header + transfer_out + transfer_in
  })

  it('R-UI-STK-4: from = to → localized client block, NO request', async () => {
    stockMock(twoByTwo)
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Transferir' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén origen'), '30')
    await user.selectOptions(screen.getByLabelText('Almacén destino'), '30')
    await user.type(screen.getByLabelText('Cantidad'), '1')
    await user.type(screen.getByLabelText('Motivo'), 'Traslado de mercadería entre bodegas')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    const dupErrors = await screen.findAllByText('El almacén origen y destino deben ser distintos')
    expect(dupErrors.length).toBeGreaterThanOrEqual(1) // shown on the from/to fields
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/stock/transfers')).toHaveLength(0)
  })

  it('R-UI-STK-4: insufficient source — A "2" transfer 5 → localized 409, both cells unchanged', async () => {
    stockMock([
      { productId: '20', warehouseId: '30', level: 2 },
      { productId: '20', warehouseId: '31', level: 0 },
    ])
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Transferir' }))
    await user.selectOptions(screen.getByLabelText('Producto'), '20')
    await user.selectOptions(screen.getByLabelText('Almacén origen'), '30')
    await user.selectOptions(screen.getByLabelText('Almacén destino'), '31')
    await user.type(screen.getByLabelText('Cantidad'), '5')
    await user.type(screen.getByLabelText('Motivo'), 'Traslado de mercadería entre bodegas')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('La operación dejaría el stock en negativo')).toBeInTheDocument()
    // cells unchanged: A still 2, B still 0
    await waitFor(() => expect(screen.getAllByText('2')).toHaveLength(1))
    expect(screen.getAllByText('0')).toHaveLength(1)
  })
})

/* ── R-UI-CRM-5: inactive product exclusion from stock levels (it6 T-6-3) ─ */

describe('R-UI-CRM-5: inactive products absent from stock levels (backend contract)', () => {
  it('R-UI-CRM-5: an inactive product with stock rows never renders in the levels table — only the served (active) set shows', async () => {
    const withInactiveProduct = [
      productFixture({ id: '20', name: 'Widget', sku: 'WID-1', lowStockThreshold: 5 }),
      productFixture({ id: '21', name: 'Gadget', sku: 'GAD-2', lowStockThreshold: 2 }),
      productFixture({ id: '22', name: 'Retired', sku: 'RET-9', lowStockThreshold: 1, active: false }),
    ]
    stockMock(
      [
        { productId: '20', warehouseId: '30', level: 10 },
        { productId: '21', warehouseId: '30', level: 8 },
        { productId: '22', warehouseId: '30', level: 4 }, // inactive product — backend excludes it (it1, #1433)
      ],
      { products: withInactiveProduct },
    )
    renderStock()
    await screen.findByRole('heading', { name: 'Niveles de stock' })

    // exactly the active rows render: header + Widget + Gadget (no Retired row)
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Widget')).toBeInTheDocument()
    expect(within(table).getByText('Gadget')).toBeInTheDocument()
    expect(within(table).queryByText('Retired')).toBeNull()
    expect(within(table).queryByText('RET-9')).toBeNull()
  })
})

/* ── isLowStock pure helper (R-UI-STK-1) ─────────────────────────────── */

describe('isLowStock (R-UI-STK-1)', () => {
  it('isLowStock: level below threshold and EQUAL level both count as low', () => {
    expect(isLowStock('3', 5)).toBe(true)
    expect(isLowStock('5', 5)).toBe(true)
    expect(isLowStock('6', 5)).toBe(false)
  })
})