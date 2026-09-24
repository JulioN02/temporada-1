/**
 * T-3-5 / T-3-6 (capstone-ui it3) — Products page tests (R-UI-CRM-5..7).
 * RED: imports ProductsPage + modules/crm/productForm + validation — none
 * exist yet. Mock fetch is the single seam (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { ProductsPage } from '../src/pages/ProductsPage.tsx'
import { validateProductInput } from '../src/modules/crm/productForm.ts'
import { translate } from '../src/i18n/useTranslation.ts'
import { es } from '../src/i18n/locales/es.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture, productFixture } from './__fixtures__/api.ts'
import type { Product } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

const widget = productFixture({ id: '20', name: 'Widget', sku: 'WID-1', lowStockThreshold: 2, active: true })
const gadget = productFixture({ id: '21', name: 'Gadget', sku: 'GAD-2', lowStockThreshold: 5, active: false })

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderProducts() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/products']}>
            <ProductsPage />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/** Products list mock: q filter (name/sku), pagination, stateful PATCH. */
function productsMock(seed: Product[] = [widget, gadget]) {
  const patched = new Map<string, Partial<Product>>()
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/products?')) {
      const url = new URL(req.path, 'http://localhost')
      const q = url.searchParams.get('q')?.toLowerCase() ?? ''
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '10')
      let filtered = seed.map((p) => ({ ...p, ...(patched.get(p.id) ?? {}) }))
      if (q !== '') filtered = filtered.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      const total = filtered.length
      const slice = filtered.slice((page - 1) * limit, page * limit)
      return {
        status: 200,
        body: { data: slice, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } },
      }
    }
    if (req.path === '/api/products' && req.method === 'POST') {
      const body = req.body as { name?: string; sku?: string }
      if (body.sku === 'WID-1') return { status: 409, body: err('DUPLICATE_SKU') }
      return { status: 201, body: { product: productFixture({ id: '99', name: String(body.name) }) } }
    }
    if (req.method === 'PATCH' && req.path.startsWith('/api/products/')) {
      const id = req.path.split('/').pop()
      if (!id) return { status: 404, body: err('NOT_FOUND') }
      const changes = req.body as Partial<Product>
      if (changes.sku === 'WID-1' && id !== '20') return { status: 409, body: err('DUPLICATE_SKU') }
      patched.set(id, changes)
      return { status: 200, body: { product: productFixture({ id, ...changes }) } }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

/* ── R-UI-CRM-5: products list + search + inactive badge ─────────────── */

describe('R-UI-CRM-5: products list', () => {
  it('R-UI-CRM-5: list renders name/sku/threshold; inactive row shows the badge', async () => {
    productsMock()
    renderProducts()
    expect(await screen.findByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('WID-1')).toBeInTheDocument()
    expect(screen.getByText('Gadget')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Inactivo')).toBeInTheDocument()
  })

  it('R-UI-CRM-5: q search filters by name/sku (debounced)', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Buscar/), 'GAD')
    await waitFor(() => expect(screen.queryByText('Widget')).toBeNull())
    expect(screen.getByText('Gadget')).toBeInTheDocument()
  })
})

/* ── R-UI-CRM-6: create product ──────────────────────────────────────── */

describe('R-UI-CRM-6: create product', () => {
  it('R-UI-CRM-6: threshold −1 → localized client error, NO request', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear producto' }))
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo')
    await user.type(screen.getByLabelText('SKU'), 'NEW-1')
    await user.type(screen.getByLabelText('Umbral de stock bajo'), '-1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El umbral debe ser un número entero mayor o igual a 0')).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/products')).toHaveLength(0)
  })

  it('R-UI-CRM-6: sku with invalid characters → localized client error, NO request', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear producto' }))
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo')
    await user.type(screen.getByLabelText('SKU'), 'BAD SKU!')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(
      await screen.findByText('El SKU solo puede contener letras, números, puntos, guiones y guiones bajos'),
    ).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/products')).toHaveLength(0)
  })

  it('R-UI-CRM-6: duplicate sku → localized 409, form data intact', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear producto' }))
    await user.type(screen.getByLabelText('Nombre'), 'Copia')
    await user.type(screen.getByLabelText('SKU'), 'WID-1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ya existe un producto con ese SKU')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Copia')
    expect(screen.getByLabelText('SKU')).toHaveValue('WID-1')
  })

  it('R-UI-CRM-6: valid create → 201, toast "Producto creado", modal closes', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear producto' }))
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo Producto')
    await user.type(screen.getByLabelText('SKU'), 'NEW-9')
    await user.type(screen.getByLabelText('Umbral de stock bajo'), '3')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/products')
    expect(post?.body).toMatchObject({ name: 'Nuevo Producto', sku: 'NEW-9', lowStockThreshold: 3 })
  })
})

/* ── R-UI-CRM-7: edit + deactivate via PATCH ─────────────────────────── */

describe('R-UI-CRM-7: product edit / deactivate', () => {
  it('R-UI-CRM-7: confirm deactivate → PATCH {active:false}, row shows the inactive badge', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /Desactivar/ })[0] as HTMLElement)
    await user.click(screen.getByRole('button', { name: /Desactivar este producto/ }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/products/20')
      expect(patch?.body).toEqual({ active: false })
    })
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByText('Inactivo')).toHaveLength(2),
    ) // Widget deactivated + Gadget already inactive
  })

  it('R-UI-CRM-7: duplicate SKU on edit → localized 409, form stays open', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    // edit Gadget (id 21) and set its sku to WID-1 (already taken by id 20)
    await user.click(screen.getAllByRole('button', { name: /Editar/ })[1] as HTMLElement)
    await user.clear(screen.getByLabelText('SKU'))
    await user.type(screen.getByLabelText('SKU'), 'WID-1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ya existe un producto con ese SKU')).toBeInTheDocument()
    expect(screen.getByLabelText('SKU')).toHaveValue('WID-1')
  })

  it('R-UI-CRM-7: edit threshold → PATCH {lowStockThreshold} only', async () => {
    productsMock()
    renderProducts()
    await screen.findByText('Widget')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /Editar/ })[0] as HTMLElement)
    await user.clear(screen.getByLabelText('Umbral de stock bajo'))
    await user.type(screen.getByLabelText('Umbral de stock bajo'), '9')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/products/20')
      expect(patch?.body).toEqual({ lowStockThreshold: 9 })
    })
  })
})

/* ── validateProductInput pure helper (R-UI-CRM-6) ───────────────────── */

describe('validateProductInput (R-UI-CRM-6)', () => {
  const tEs = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(es, key, params)

  it('validateProductInput: empty name + bad sku + negative threshold → all field errors', () => {
    expect(validateProductInput({ name: ' ', sku: 'BAD!', lowStockThreshold: '-1' }, tEs)).toEqual({
      name: 'El nombre es obligatorio',
      sku: 'El SKU solo puede contener letras, números, puntos, guiones y guiones bajos',
      lowStockThreshold: 'El umbral debe ser un número entero mayor o igual a 0',
    })
  })

  it('validateProductInput: valid input → no errors; empty threshold defaults to 0 (allowed)', () => {
    expect(validateProductInput({ name: 'Widget', sku: 'WID-1', lowStockThreshold: '0' }, tEs)).toEqual({})
    expect(validateProductInput({ name: 'Widget', sku: 'WID-1', lowStockThreshold: '' }, tEs)).toEqual({})
  })
})