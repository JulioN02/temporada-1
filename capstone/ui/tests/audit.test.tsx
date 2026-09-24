/**
 * T-5-2 (capstone-ui it5) — Audit page tests (R-UI-AUD-1).
 * RED: imports AuditPage / modules/governance/audit.ts — page is a
 * placeholder, the filter helper does not exist yet. Mock fetch single seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { LocaleBackendSync } from '../src/components/LocaleBackendSync.tsx'
import { appRoutes } from '../src/App.tsx'
import { AuditPage } from '../src/pages/AuditPage.tsx'
import { auditDateRangeToIso } from '../src/modules/governance/audit.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { auditRowFixture, loginResponseFixture } from './__fixtures__/api.ts'
import type { AuditRow } from '../src/api/types.ts'

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

function renderAudit() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/audit']}>
            <Routes>
              <Route path="/audit" element={<AuditPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/**
 * Stateful audit mock: filters (entity/action/from/to) applied server-side
 * (exact match, created_at range — mirroring the backend repository),
 * newest-first order preserved from the seed.
 */
function auditMock(seed: AuditRow[]) {
  const rows = seed.map((r) => ({ ...r, payload: r.payload ? { ...r.payload } : null }))
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/audit')) {
      const url = new URL(req.path, 'http://localhost')
      const entity = url.searchParams.get('entity')
      const action = url.searchParams.get('action')
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '20')
      let filtered = rows
      if (entity) filtered = filtered.filter((r) => r.entity === entity)
      if (action) filtered = filtered.filter((r) => r.action === action)
      if (from) filtered = filtered.filter((r) => r.created_at >= from)
      if (to) filtered = filtered.filter((r) => r.created_at <= to)
      return {
        status: 200,
        body: {
          data: filtered,
          pagination: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) },
        },
      }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

const createRow = auditRowFixture({ id: '1', entity: 'customer', action: 'customer.create', actor_username: 'admin', created_at: '2026-01-08T00:00:00.000Z' })
const updateRow = auditRowFixture({ id: '2', entity: 'customer', action: 'customer.update', actor_username: 'maria', created_at: '2026-01-07T00:00:00.000Z' })
const orderRow = auditRowFixture({ id: '3', entity: 'order', action: 'order.confirm', actor_username: 'admin', created_at: '2026-01-06T00:00:00.000Z' })

/* ── R-UI-AUD-1: filterable table, payload as JSON text ───────────────── */

describe('R-UI-AUD-1: audit trail table', () => {
  it('R-UI-AUD-1: renders rows with timestamp/actor/entity/entityId/action/payload, newest-first as served', async () => {
    auditMock([createRow, updateRow, orderRow])
    renderAudit()
    await screen.findByRole('table')
    const rows = screen.getAllByRole('row')
    // header + 3 data rows in API order (backend newest-first)
    expect(rows).toHaveLength(4)
    const body = rows.slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
    // first row = createRow (served first)
    expect(within(rows[1] as HTMLElement).getByText('customer.create')).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText('customer.update')).toBeInTheDocument()
    expect(within(rows[3] as HTMLElement).getByText('order.confirm')).toBeInTheDocument()
    expect(body.length).toBe(3)
    // actor + entityId columns visible
    expect(within(rows[1] as HTMLElement).getByText('admin')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('10')).toBeInTheDocument()
  })

  it('R-UI-AUD-1: entity + action filters → request carries params, only matching rows render', async () => {
    auditMock([createRow, updateRow, orderRow])
    renderAudit()
    await screen.findByRole('table')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Entidad'), 'customer')
    await user.type(screen.getByLabelText('Acción'), 'customer.create')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))

    await waitFor(() => {
      const req = mock.requests.find((r) => r.method === 'GET' && r.path.includes('entity=customer') && r.path.includes('action=customer.create'))
      expect(req).toBeTruthy()
    })
    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(2) // header + only the matching row
    })
    expect(screen.getByText('customer.create')).toBeInTheDocument()
    expect(screen.queryByText('order.confirm')).toBeNull()
  })

  it('R-UI-AUD-1: from/to date inputs → converted to ISO datetimes in the request', async () => {
    auditMock([createRow, updateRow, orderRow])
    renderAudit()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-07' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-01-08' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Filtrar' }))

    await waitFor(() => {
      const req = mock.requests.find((r) => r.method === 'GET' && r.path.includes('from='))
      expect(req).toBeTruthy()
      expect(req?.path).toContain('from=2026-01-07T00%3A00%3A00.000Z')
      expect(req?.path).toContain('to=2026-01-08T23%3A59%3A59.999Z')
    })
    // updateRow (01-07) + createRow (01-08) match the range; orderRow (01-06) does not
    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(3)
    })
    expect(screen.queryByText('order.confirm')).toBeNull()
  })

  it('R-UI-AUD-1: payload with <script> renders as literal JSON text — never executed', async () => {
    auditMock([
      auditRowFixture({
        id: '9',
        entity: 'customer',
        action: 'customer.create',
        payload: { name: '<script>alert(1)</script>', note: 'unsafe' },
      }),
    ])
    renderAudit()
    await screen.findByRole('table')
    // JSON text is rendered as a text node (React escapes it — R-UI-NFR-2)
    const payloadCell = screen.getByText(/<script>alert\(1\)<\/script>/)
    expect(payloadCell.textContent).toContain('<script>alert(1)</script>')
    // no script element was injected into the document
    expect(document.querySelector('script')?.textContent?.includes('alert(1)')).toBeFalsy()
  })

  it('R-UI-AUD-1: empty filtered result → localized empty state', async () => {
    auditMock([createRow])
    renderAudit()
    await screen.findByRole('table')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Entidad'), 'warehouse')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(await screen.findByText('No hay registros de auditoría')).toBeInTheDocument()
  })
})

/* ── R-UI-AUD-1: 403 guard (operator → redirect, no request) ──────────── */

describe('R-UI-AUD-1: operator guard', () => {
  it('R-UI-AUD-1: operator hits /audit → redirect /dashboard + denial toast, NO /api/audit request', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'operator' }) }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/audit'] })
    render(
      <LocaleProvider>
        <ToastProvider>
          <AuthProvider>
            <LocaleBackendSync />
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </LocaleProvider>,
    )
    expect(await screen.findByText('No tienes permiso para acceder a esta sección')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Panel' })).toBeInTheDocument()
    expect(mock.requests.some((r) => r.path.startsWith('/api/audit'))).toBe(false)
  })
})

/* ── Pure helper (extract-before-mock) ────────────────────────────────── */

describe('auditDateRangeToIso', () => {
  it('converts YYYY-MM-DD date inputs to ISO datetimes with offset (backend .datetime contract)', () => {
    expect(auditDateRangeToIso('2026-01-07', '2026-01-08')).toEqual({
      from: '2026-01-07T00:00:00.000Z',
      to: '2026-01-08T23:59:59.999Z',
    })
  })

  it('empty inputs → undefined (param omitted)', () => {
    expect(auditDateRangeToIso('', '')).toEqual({})
    expect(auditDateRangeToIso('2026-01-07', '')).toEqual({ from: '2026-01-07T00:00:00.000Z' })
  })
})