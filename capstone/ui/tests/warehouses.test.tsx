/**
 * T-3-7 (capstone-ui it3) — Warehouses tab tests (R-UI-CRM-8).
 * RED: imports modules/stock/WarehousesTab — does not exist yet.
 * List from GET /api/warehouses (it1 delta — no derived-from-stock
 * workaround), create form (POST, 422 localized), rename PATCH and
 * confirm-gated DELETE with the 409 WAREHOUSE_IN_USE handled locally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { WarehousesTab } from '../src/modules/stock/WarehousesTab.tsx'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture, warehouseFixture } from './__fixtures__/api.ts'
import type { Warehouse } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

const mainWh = warehouseFixture({ id: '30', name: 'Main WH' })
const northWh = warehouseFixture({ id: '31', name: 'North WH' })

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderWarehouses() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <WarehousesTab />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

function warehousesMock(seed: Warehouse[] = [mainWh, northWh]) {
  const renamed = new Map<string, string>()
  const deleted = new Set<string>()
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/warehouses')) {
      const page = 1
      const limit = 20
      const items = seed.filter((w) => !deleted.has(w.id)).map((w) => ({ ...w, name: renamed.get(w.id) ?? w.name }))
      return {
        status: 200,
        body: { data: items, pagination: { page, limit, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / limit)) } },
      }
    }
    if (req.path === '/api/warehouses' && req.method === 'POST') {
      const body = req.body as { name?: string }
      if (body.name === 'Main WH') return { status: 409, body: err('CONFLICT') }
      return { status: 201, body: { warehouse: warehouseFixture({ id: '99', name: String(body.name) }) } }
    }
    if (req.method === 'PATCH' && req.path.startsWith('/api/warehouses/')) {
      const id = req.path.split('/').pop()
      const body = req.body as { name?: string }
      if (body.name === 'Main WH' && id !== '30') return { status: 409, body: err('CONFLICT') }
      renamed.set(String(id), String(body.name))
      return { status: 200, body: { warehouse: warehouseFixture({ id: String(id), name: String(body.name) }) } }
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/warehouses/')) {
      const id = req.path.split('/').pop()
      if (id === '30') return { status: 409, body: err('WAREHOUSE_IN_USE') } // in use
      deleted.add(String(id))
      return { status: 204 }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

/* ── R-UI-CRM-8: list + create ───────────────────────────────────────── */

describe('R-UI-CRM-8: warehouses list + create', () => {
  it('R-UI-CRM-8: list renders warehouses from GET /api/warehouses', async () => {
    warehousesMock()
    renderWarehouses()
    expect(await screen.findByText('Main WH')).toBeInTheDocument()
    expect(screen.getByText('North WH')).toBeInTheDocument()
  })

  it('R-UI-CRM-8: create valid name → 201, toast "Almacén creado", list refreshed', async () => {
    warehousesMock()
    renderWarehouses()
    await screen.findByText('Main WH')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear almacén' }))
    await user.type(screen.getByLabelText('Nombre'), 'South WH')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Almacén creado')).toBeInTheDocument()
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/warehouses')
    expect(post?.body).toEqual({ name: 'South WH' })
  })

  it('R-UI-CRM-8: empty name → localized client block, NO request', async () => {
    warehousesMock()
    renderWarehouses()
    await screen.findByText('Main WH')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear almacén' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/warehouses')).toHaveLength(0)
  })

  it('R-UI-CRM-8: duplicate name → localized 409 (CONFLICT → generic conflict)', async () => {
    warehousesMock()
    renderWarehouses()
    await screen.findByText('Main WH')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Crear almacén' }))
    await user.type(screen.getByLabelText('Nombre'), 'Main WH')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('La operación entró en conflicto con los datos actuales')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Main WH') // form intact
  })
})

/* ── R-UI-CRM-8: rename + delete (WAREHOUSE_IN_USE handled) ───────────── */

describe('R-UI-CRM-8: warehouse rename + delete', () => {
  it('R-UI-CRM-8: rename → PATCH {name} + "Almacén actualizado" toast', async () => {
    warehousesMock()
    renderWarehouses()
    await screen.findByText('Main WH')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /Editar/ })[1] as HTMLElement) // North WH
    await user.clear(screen.getByLabelText('Nombre'))
    await user.type(screen.getByLabelText('Nombre'), 'North Annex')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/warehouses/31')
      expect(patch?.body).toEqual({ name: 'North Annex' })
    })
    expect(await screen.findByText('Almacén actualizado')).toBeInTheDocument()
  })

  it('R-UI-CRM-8: delete in-use warehouse → localized 409 WAREHOUSE_IN_USE toast, list unchanged', async () => {
    warehousesMock()
    renderWarehouses()
    await screen.findByText('Main WH')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /Eliminar/ })[0] as HTMLElement)
    await user.click(screen.getByRole('button', { name: /Eliminar este almacén/ }))

    expect(
      await screen.findByText('El almacén está en uso y no se puede eliminar'),
    ).toBeInTheDocument()
    // list still shows both warehouses
    expect(screen.getByText('Main WH')).toBeInTheDocument()
    expect(screen.getByText('North WH')).toBeInTheDocument()
  })

  it('R-UI-CRM-8: delete free warehouse → 204, row removed from the list', async () => {
    warehousesMock()
    renderWarehouses()
    await screen.findByText('Main WH')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /Eliminar/ })[1] as HTMLElement) // North WH (free)
    await user.click(screen.getByRole('button', { name: /Eliminar este almacén/ }))

    await waitFor(() => expect(screen.queryByText('North WH')).toBeNull())
    expect(screen.getByText('Main WH')).toBeInTheDocument()
    const del = mock.requests.find((r) => r.method === 'DELETE' && r.path === '/api/warehouses/31')
    expect(del).toBeTruthy()
  })
})