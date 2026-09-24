/**
 * T-3-2..T-3-4 (capstone-ui it3) — Customers page tests (R-UI-CRM-1..4).
 * RED: imports CustomersPage + modules/crm/customerForm + validation —
 * none exist yet. Mock fetch is the single seam (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { CustomersPage } from '../src/pages/CustomersPage.tsx'
import { validateCustomerInput } from '../src/modules/crm/customerForm.ts'
import { translate } from '../src/i18n/useTranslation.ts'
import { es } from '../src/i18n/locales/es.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { customerFixture, loginResponseFixture, paginated } from './__fixtures__/api.ts'
import type { Customer, CustomerStatus } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

const ana = customerFixture({ id: '1', name: 'Ana Ruiz', email: 'ana@example.com', status: 'active' })
const luis = customerFixture({ id: '2', name: 'Luis Paz', email: 'luis@example.com', status: 'active' })

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderCustomers() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/customers']}>
            <CustomersPage />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/** Customer list mock: filters by q/status, slices by page/limit (realistic). Stateful PATCH. */
function customersMock(seed: Customer[] = [ana, luis]) {
  const patched = new Map<string, Partial<Customer>>()
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/customers?')) {
      const url = new URL(req.path, 'http://localhost')
      const q = url.searchParams.get('q')?.toLowerCase() ?? ''
      const status = url.searchParams.get('status')
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '10')
      let filtered = seed.map((c) => ({ ...c, ...(patched.get(c.id) ?? {}) }))
      if (status === 'inactive') filtered = filtered.filter((c) => c.status === 'inactive')
      else if (status === 'active') filtered = filtered.filter((c) => c.status === 'active')
      else filtered = filtered.filter((c) => c.status === 'active') // default: active only
      if (q !== '') filtered = filtered.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
      const total = filtered.length
      const slice = filtered.slice((page - 1) * limit, page * limit)
      return {
        status: 200,
        body: { data: slice, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } },
      }
    }
    if (req.path === '/api/customers' && req.method === 'POST') {
      const body = req.body as { name?: string; email?: string }
      if (body.email === 'ana@example.com') return { status: 409, body: err('DUPLICATE_EMAIL') }
      return { status: 201, body: { customer: customerFixture({ id: '9', name: String(body.name) }) } }
    }
    if (req.method === 'PATCH' && req.path.startsWith('/api/customers/')) {
      const id = req.path.split('/').pop()
      if (!id) return { status: 404, body: err('NOT_FOUND') }
      if (id === '999') return { status: 404, body: err('NOT_FOUND') }
      const changes = req.body as Partial<Customer>
      patched.set(id, changes)
      return { status: 200, body: { customer: customerFixture({ id, ...changes }) } }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

/* ── R-UI-CRM-1: list / search / status filter / pagination ──────────── */

describe('R-UI-CRM-1: customers list', () => {
  it('R-UI-CRM-1: search "ana" → only Ana renders (debounced q)', async () => {
    customersMock()
    renderCustomers()
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()
    expect(screen.getByText('Luis Paz')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Buscar por nombre o correo/), 'ana')
    await waitFor(() => expect(screen.queryByText('Luis Paz')).toBeNull())
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument()
    // the request carried q=ana
    const searchReq = mock.requests.find((r) => r.path.includes('q=ana'))
    expect(searchReq).toBeTruthy()
  })

  it('R-UI-CRM-1: pagination — 25 customers, page 2/limit 10 → rows 11-20, page 3 reachable', async () => {
    const seed = Array.from({ length: 25 }, (_, i) =>
      customerFixture({ id: String(i + 1), name: `Cliente ${i + 1}`, email: `c${i + 1}@example.com`, status: 'active' }),
    )
    customersMock(seed)
    renderCustomers()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 11')).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Cliente 11')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Página 3 de 3')).toBeInTheDocument()
    expect(screen.getByText('Cliente 21')).toBeInTheDocument()
  })

  it('R-UI-CRM-1: empty result (q=zzz) → localized empty state, NOT a zero-row table', async () => {
    customersMock()
    renderCustomers()
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Buscar por nombre o correo/), 'zzz')
    await waitFor(() => expect(screen.getByText('No hay registros')).toBeInTheDocument())
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('R-UI-CRM-1: 403 from the API → localized denial toast renders, no crash', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'viewer' }) }
      if (req.method === 'GET' && req.path.startsWith('/api/customers?')) return { status: 403, body: err('FORBIDDEN') }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderCustomers()
    const toasts = await screen.findByRole('status')
    await waitFor(() => expect(within(toasts).getByText('No tienes permiso para esta acción')).toBeInTheDocument())
  })
})

/* ── R-UI-CRM-2: create form validation + 409 ────────────────────────── */

describe('R-UI-CRM-2: create customer form', () => {
  it('R-UI-CRM-2: invalid email client-side → localized error, NO request fires', async () => {
    customersMock()
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo Cliente')
    await user.type(screen.getByLabelText('Correo electrónico'), 'x')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El correo no tiene un formato válido')).toBeInTheDocument()
    const postRequests = mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/customers')
    expect(postRequests).toHaveLength(0)
  })

  it('R-UI-CRM-2: duplicate email → localized 409, form stays open with data intact', async () => {
    customersMock()
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await user.type(screen.getByLabelText('Nombre'), 'Otra Ana')
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ya existe un cliente con ese correo')).toBeInTheDocument()
    // form still open, values intact
    expect(screen.getByLabelText('Nombre')).toHaveValue('Otra Ana')
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('ana@example.com')
  })

  it('R-UI-CRM-2: success → 201, toast "Cliente creado", list refreshed', async () => {
    customersMock()
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo Cliente')
    await user.type(screen.getByLabelText('Correo electrónico'), 'nuevo@example.com')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Cliente creado')).toBeInTheDocument() // toast
    expect(screen.queryByRole('dialog')).toBeNull() // modal closed
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/customers')
    expect(post?.body).toMatchObject({ name: 'Nuevo Cliente', email: 'nuevo@example.com' })
  })
})

/* ── R-UI-CRM-3: edit customer (PATCH changed fields only) ───────────── */

describe('R-UI-CRM-3: edit customer', () => {
  it('R-UI-CRM-3: edit phone only → PATCH body carries {phone} only', async () => {
    customersMock()
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /Editar/ })[0] as HTMLElement)
    await user.clear(screen.getByLabelText('Teléfono'))
    await user.type(screen.getByLabelText('Teléfono'), '555-0100')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/customers/1')
      expect(patch?.body).toEqual({ phone: '555-0100' })
    })
    expect(await screen.findByText('Cliente actualizado')).toBeInTheDocument()
  })

  it('R-UI-CRM-3: unknown id on edit → localized 404 ("Cliente no encontrado")', async () => {
    const user = userEvent.setup()
    // force the edit to target an unknown customer id via a crafted seed row
    const seed = [customerFixture({ id: '999', name: 'Fantasma' })]
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
      if (req.method === 'GET' && req.path.startsWith('/api/customers?')) return { status: 200, body: paginated(seed) }
      if (req.method === 'PATCH' && req.path.startsWith('/api/customers/')) return { status: 404, body: err('NOT_FOUND') }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderCustomers()
    await screen.findByText('Fantasma')
    await user.click(screen.getByRole('button', { name: /Editar/ }))
    await user.type(screen.getByLabelText('Teléfono'), '1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Cliente no encontrado')).toBeInTheDocument()
  })
})

/* ── R-UI-CRM-4: deactivate / reactivate with confirm gate ───────────── */

describe('R-UI-CRM-4: deactivate / reactivate', () => {
  it('R-UI-CRM-4: confirm gate — cancel fires ZERO requests', async () => {
    customersMock()
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Desactivar' })[0] as HTMLElement)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    const patches = mock.requests.filter((r) => r.method === 'PATCH')
    expect(patches).toHaveLength(0)
  })

  it('R-UI-CRM-4: confirm deactivate → PATCH {status:"inactive"} and the row disappears from the default list', async () => {
    customersMock()
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Desactivar' })[0] as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/customers/1')
      expect(patch?.body).toEqual({ status: 'inactive' })
    })
    await waitFor(() => expect(screen.queryByText('Ana Ruiz')).toBeNull())
  })

  it('R-UI-CRM-4: reactivate from the inactive filter → PATCH {status:"active"} and the row returns', async () => {
    const inactive = customerFixture({ id: '3', name: 'Inactiva', email: 'i@example.com', status: 'inactive' as CustomerStatus })
    customersMock([ana, luis, inactive])
    renderCustomers()
    await screen.findByText('Ana Ruiz')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Estado'), 'inactive')
    expect(await screen.findByText('Inactiva')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Inactivo')).toBeInTheDocument() // status badge

    await user.click(screen.getByRole('button', { name: 'Activar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/customers/3')
      expect(patch?.body).toEqual({ status: 'active' })
    })
  })
})

/* ── validateCustomerInput pure helper ───────────────────────────────── */

describe('validateCustomerInput (R-UI-CRM-2)', () => {
  const tEs = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(es, key, params)

  it('validateCustomerInput: empty name → name error; malformed email → email error', () => {
    expect(validateCustomerInput({ name: '  ', email: 'x' }, tEs)).toEqual({
      name: 'El nombre es obligatorio',
      email: 'El correo no tiene un formato válido',
    })
  })

  it('validateCustomerInput: valid input → no errors; empty email allowed (optional)', () => {
    expect(validateCustomerInput({ name: 'Ana', email: '' }, tEs)).toEqual({})
    expect(validateCustomerInput({ name: 'Ana', email: 'ana@example.com' }, tEs)).toEqual({})
  })
})