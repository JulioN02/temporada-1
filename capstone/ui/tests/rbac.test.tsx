/**
 * T-2-6 / T-2-7 / T-2-10 (capstone-ui it2b) — RBAC mirror, parity and guard
 * tests (R-RBAC-1..3, R-UI-FND-2). RED: imports permissions.ts / RoleGate /
 * PermissionRoute-backed routes — none exist yet.
 * The parity test imports the BACKEND registry directly across workspaces
 * (design flag c — verified importable at apply; no server-only imports).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ROLE_PERMISSIONS as BACKEND_ROLE_PERMISSIONS } from '../../backend/src/permissions/registry.ts'
import { ROLE_PERMISSIONS as UI_ROLE_PERMISSIONS, roleHasPermission } from '../src/auth/permissions.ts'
import type { RolePermission } from '../src/auth/permissions.ts'
import { RoleGate } from '../src/components/RoleGate.tsx'
import { AuthProvider, useAuth } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { LocaleBackendSync } from '../src/components/LocaleBackendSync.tsx'
import { appRoutes } from '../src/App.tsx'
import { setAccessToken, setSessionExpiredHandler } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture } from './__fixtures__/api.ts'
import type { Role } from '../src/api/types.ts'

let mock: MockFetchHandle

beforeEach(() => {
  setAccessToken(null)
  setSessionExpiredHandler(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  setSessionExpiredHandler(null)
})

/** Expected sidebar nav labels per role (R-RBAC-3 matrix → module read perms). */
const EXPECTED_NAV: Record<Role, readonly string[]> = {
  admin: ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones', 'Auditoría', 'Usuarios', 'Trabajos'],
  manager: ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones', 'Trabajos'],
  operator: ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones'],
  viewer: ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones'],
  auditor: ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones', 'Auditoría'],
}

const ALL_NAV_LABELS: readonly string[] = [
  'Panel',
  'Clientes',
  'Productos',
  'Stock',
  'Pedidos',
  'Notificaciones',
  'Auditoría',
  'Usuarios',
  'Trabajos',
]

/* ── R-RBAC-3: matrix parity (UI mirror ≡ backend registry) ───────────── */

describe('R-RBAC-3: UI mirror ≡ backend ROLE_PERMISSIONS (parity)', () => {
  it('R-RBAC-3: role keys match the backend registry exactly', () => {
    expect(Object.keys(UI_ROLE_PERMISSIONS).sort()).toEqual(Object.keys(BACKEND_ROLE_PERMISSIONS).sort())
  })

  it('R-RBAC-3: every role has the IDENTICAL permission set (deep-equal, order-insensitive)', () => {
    for (const role of Object.keys(UI_ROLE_PERMISSIONS)) {
      const ui = new Set(UI_ROLE_PERMISSIONS[role as Role])
      const backend = new Set(BACKEND_ROLE_PERMISSIONS[role as Role])
      expect(ui).toEqual(backend)
    }
  })

  it('R-RBAC-3: 5 roles × 19 codes — the full code universe is mirrored', () => {
    const universe = new Set<string>()
    for (const permissions of Object.values(UI_ROLE_PERMISSIONS)) {
      for (const permission of permissions) universe.add(permission)
    }
    expect(Object.keys(UI_ROLE_PERMISSIONS)).toHaveLength(5)
    expect(universe.size).toBe(19)
  })

  it('R-RBAC-3: unknown role → empty permission set (no privileged UI)', () => {
    expect(roleHasPermission('hacker', 'audit:read')).toBe(false)
    expect(roleHasPermission('viewer', 'audit:read')).toBe(false)
    expect(roleHasPermission('auditor', 'audit:read')).toBe(true)
  })
})

/* ── R-RBAC-3: five-role sidebar sweep ────────────────────────────────── */

describe('R-RBAC-3: five-role sweep — exact sidebar set per role', () => {
  for (const role of Object.keys(EXPECTED_NAV) as Role[]) {
    it(`R-RBAC-3: ${role} sidebar shows exactly ${EXPECTED_NAV[role].length} modules — no extra, no missing`, async () => {
      mock = createMockFetch((req) => {
        if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role }) }
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
      })
      vi.stubGlobal('fetch', mock.fetchMock)
      const router = createMemoryRouter(appRoutes, { initialEntries: ['/dashboard'] })
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
      await screen.findByRole('heading', { name: 'Panel' })
      // scope to the sidebar nav — the dashboard body has its own links
      // (e.g. R-UI-DSH-3 notifications link) that must not count here.
      const sidebar = within(screen.getByRole('navigation'))

      for (const label of EXPECTED_NAV[role]) {
        expect(sidebar.getByRole('link', { name: label })).toBeInTheDocument()
      }
      for (const label of ALL_NAV_LABELS.filter((l) => !EXPECTED_NAV[role].includes(l))) {
        expect(sidebar.queryByRole('link', { name: label })).toBeNull()
      }
    })
  }
})

/* ── R-RBAC-2: action-level RoleGate (hide, never disable) ────────────── */

function RoleGateProbe({ permission }: { permission: RolePermission }) {
  const { user } = useAuth()
  return (
    <div data-testid="gate-root" data-user={user ? 'set' : 'null'}>
      <RoleGate permission={permission}>
        <span data-testid="visible-action">yes</span>
      </RoleGate>
    </div>
  )
}

async function renderRoleGate(role: Role, permission: RolePermission): Promise<void> {
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role }) }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
  render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <RoleGateProbe permission={permission} />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
  // wait for the boot restore to finish so visibility reflects the real role
  await waitFor(() => expect(screen.getByTestId('gate-root')).toHaveAttribute('data-user', 'set'))
}

describe('R-RBAC-2: action-level guards (hidden, never disabled)', () => {
  it('R-RBAC-2: operator — "Ajustar" (stock:stock_adjust) is visible', async () => {
    await renderRoleGate('operator', 'stock:stock_adjust')
    expect(screen.getByTestId('visible-action')).toBeInTheDocument()
  })

  it('R-RBAC-2: operator — "Transferir" (stock:stock_transfer) is hidden', async () => {
    await renderRoleGate('operator', 'stock:stock_transfer')
    expect(screen.queryByTestId('visible-action')).toBeNull()
  })

  it('R-RBAC-2: manager — "Reintentar" (jobs:job_retry) is visible', async () => {
    await renderRoleGate('manager', 'jobs:job_retry')
    expect(screen.getByTestId('visible-action')).toBeInTheDocument()
  })

  it('R-RBAC-2: viewer — create action (crm:customer_create) is hidden', async () => {
    await renderRoleGate('viewer', 'crm:customer_create')
    expect(screen.queryByTestId('visible-action')).toBeNull()
  })
})

/* ── R-RBAC-1: allowed route renders (auditor → /audit) ───────────────── */

describe('R-RBAC-1: allowed permission routes render', () => {
  it('R-RBAC-1: auditor hits /audit → page renders (allowed, read-only)', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'auditor' }) }
      // the real AuditPage (it5) fetches the trail on mount — serve an empty page
      if (req.method === 'GET' && req.path.startsWith('/api/audit')) {
        return { status: 200, body: { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } } }
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
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
    // /audit is a LAZY chunk (R-UI-NFR-5): its first load transforms the
    // module graph on this slow machine — wait past the 1s default (the
    // Batch C testTimeout-15000 mitigation applies to per-test timeout only).
    expect(await screen.findByRole('heading', { name: 'Auditoría' }, { timeout: 10000 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/audit')
  })
})

/* ── R-RBAC-3: five-role × action EXACT matrix sweep (it6 T-6-1) ─────── */

/**
 * Every permission code that gates an ACTION in the UI (create/edit/delete/
 * adjust/transfer/confirm/cancel/retry/mark-read + module-view gates whose
 * absence hides the whole module). The R-RBAC-3 matrix table in the spec.
 */
const ACTION_PERMISSIONS: readonly RolePermission[] = [
  'crm:customer_create',
  'crm:customer_update',
  'stock:product_manage',
  'stock:stock_adjust',
  'stock:stock_transfer',
  'orders:order_create',
  'orders:order_confirm',
  'orders:order_cancel',
  'notification:update',
  'auth:user_read',
  'jobs:job_read',
  'jobs:job_retry',
  'audit:read',
]

/** One RoleGate per action permission — the probe renders the full matrix. */
function MatrixProbe({ permissions }: { permissions: readonly RolePermission[] }) {
  const { user } = useAuth()
  return (
    <div data-testid="matrix-root" data-user={user ? 'set' : 'null'}>
      {permissions.map((permission) => (
        <RoleGate key={permission} permission={permission}>
          <span data-testid={`visible-${permission}`}>{permission}</span>
        </RoleGate>
      ))}
    </div>
  )
}

async function renderMatrixProbe(role: Role): Promise<void> {
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role }) }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
  render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MatrixProbe permissions={ACTION_PERMISSIONS} />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
  // wait for the boot restore to finish so visibility reflects the real role
  await waitFor(() => expect(screen.getByTestId('matrix-root')).toHaveAttribute('data-user', 'set'))
}

describe('R-RBAC-3: five-role sweep — EXACT action set per role (no extra, no missing)', () => {
  for (const role of Object.keys(BACKEND_ROLE_PERMISSIONS) as Role[]) {
    const expected = new Set(BACKEND_ROLE_PERMISSIONS[role] as readonly string[])
    it(`R-RBAC-3: ${role} — visible actions are exactly ${ACTION_PERMISSIONS.filter((p) => expected.has(p)).length}/${ACTION_PERMISSIONS.length} of the matrix row`, async () => {
      await renderMatrixProbe(role)
      for (const permission of ACTION_PERMISSIONS) {
        const element = screen.queryByTestId(`visible-${permission}`)
        if (expected.has(permission)) {
          expect(element).toBeInTheDocument()
        } else {
          expect(element).toBeNull()
        }
      }
    })
  }
})

/* ── R-RBAC-4: mid-session role change reflects on next /api/auth/me ──── */

/**
 * Boot a FULL shell (Layout + Sidebar + router) for `bootRole`; the first
 * navigation fires the shell's `GET /api/auth/me` re-fetch (design ADR-6),
 * which the responder scripts to return `nextRole`.
 */
async function bootShellThenNavigate(bootRole: Role, nextRole: Role, targetLabel: string): Promise<{ router: ReturnType<typeof createMemoryRouter> }> {
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: bootRole }) }
    if (req.path === '/api/auth/me' && req.method === 'GET') {
      return { status: 200, body: { user: loginResponseFixture({ role: nextRole }).user } }
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/dashboard'] })
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
  await screen.findByRole('heading', { name: 'Panel' })
  const sidebar = within(screen.getByRole('navigation'))
  const user = userEvent.setup()
  await user.click(sidebar.getByRole('link', { name: targetLabel }))
  // the navigation must fire the shell's GET /api/auth/me re-fetch — for the
  // stale-route case the redirect back to /dashboard can beat the pathname
  // check, so wait on the request itself, not the intermediate route.
  await waitFor(() => {
    expect(mock.requests.some((r) => r.method === 'GET' && r.path === '/api/auth/me')).toBe(true)
  })
  return { router }
}

describe('R-RBAC-4: mid-session demotion — next /api/auth/me re-renders visibility', () => {
  it('R-RBAC-4: manager demoted to operator — sidebar drops "Trabajos" after the me() re-fetch', async () => {
    await bootShellThenNavigate('manager', 'operator', 'Pedidos')

    // the fresh payload (operator, no jobs:job_read) must re-render the sidebar
    await waitFor(() => {
      const sidebar = within(screen.getByRole('navigation'))
      expect(sidebar.queryByRole('link', { name: 'Trabajos' })).toBeNull()
    })
    // a GET /api/auth/me was actually fired on navigation (not a client-side guess)
    expect(mock.requests.filter((r) => r.method === 'GET' && r.path === '/api/auth/me')).toHaveLength(1)
  })

  it('R-RBAC-4: admin demoted to manager — a stale /users visit redirects + denial toast once me() lands', async () => {
    const { router } = await bootShellThenNavigate('admin', 'manager', 'Usuarios')

    // PermissionRoute re-renders from the fresh payload → deny + toast + redirect
    expect(await screen.findByText('No tienes permiso para acceder a esta sección')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    const sidebar = within(screen.getByRole('navigation'))
    expect(sidebar.queryByRole('link', { name: 'Usuarios' })).toBeNull()
    expect(mock.requests.filter((r) => r.method === 'GET' && r.path === '/api/auth/me')).toHaveLength(1)
  })
})