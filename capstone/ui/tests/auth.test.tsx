/**
 * T-2-6 / T-2-8 / T-2-10 (capstone-ui it2b) — auth session, guards and shell
 * component tests (R-AUTHUI-2..4, R-UI-FND-1/2, R-RBAC-1, R-I18N-3).
 * RED: imports AuthContext / ProtectedRoute / PermissionRoute / Layout /
 * LoginPage / LocaleToggle / LocaleBackendSync — none exist yet.
 * Mock fetch is the single seam — no live backend (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/App.tsx'
import { AuthProvider, useAuth } from '../src/auth/AuthContext.tsx'
import { getAccessToken, setAccessToken, setSessionExpiredHandler } from '../src/api/client.ts'
import { LocaleProvider, LOCALE_STORAGE_KEY } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { LocaleBackendSync } from '../src/components/LocaleBackendSync.tsx'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture, userFixture } from './__fixtures__/api.ts'
import type { Role } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

beforeEach(() => {
  setAccessToken(null)
  setSessionExpiredHandler(null)
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  setSessionExpiredHandler(null)
})

/** Boot a session: role = user restored via refresh, null = anonymous. */
function bootSession(role: Role | null): void {
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') {
      return role === null
        ? { status: 401, body: err('UNAUTHORIZED') }
        : { status: 200, body: loginResponseFixture({ role }) }
    }
    if (req.path === '/api/auth/logout') return { status: 204 }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
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
  return router
}

const refreshCalls = () => mock.requests.filter((r) => r.path === '/api/auth/refresh').length

/* ── R-AUTHUI-4: boot session restore ─────────────────────────────────── */

describe('R-AUTHUI-4: boot session restore (single round trip, route preservation)', () => {
  it('R-AUTHUI-4: valid refresh cookie — boot on /orders restores silently, no login flash', async () => {
    bootSession('admin')
    renderAt('/orders')
    expect(await screen.findByRole('heading', { name: 'Pedidos' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).toBeNull()
    expect(refreshCalls()).toBe(1) // single round trip
  })

  it('R-AUTHUI-4: no session — /orders redirects to /login?next=/orders and returns there after login', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 401, body: err('UNAUTHORIZED') }
      if (req.path === '/api/auth/login') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    const router = renderAt('/orders')

    await screen.findByRole('heading', { name: 'Iniciar sesión' })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/orders')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Usuario'), 'admin')
    await user.type(screen.getByLabelText('Contraseña'), 'Secret123')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('heading', { name: 'Pedidos' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/orders')
  })

  it('R-AUTHUI-4: restore failure — bounded, lands on /login, no loop', async () => {
    bootSession(null)
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'Iniciar sesión' })
    expect(refreshCalls()).toBe(1) // exactly one attempt — no retry loop
  })
})

/* ── R-AUTHUI-3: logout ───────────────────────────────────────────────── */

describe('R-AUTHUI-3: logout clears session and calls the API', () => {
  it('R-AUTHUI-3: logout fires POST /api/auth/logout, clears memory, lands on /login', async () => {
    bootSession('admin')
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'Panel' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    await screen.findByRole('heading', { name: 'Iniciar sesión' })
    const logoutRequests = mock.requests.filter((r) => r.path === '/api/auth/logout')
    expect(logoutRequests).toHaveLength(1)
    expect(logoutRequests[0]?.method).toBe('POST')
    expect(getAccessToken()).toBeNull()
  })

  it('R-AUTHUI-3: logout invoked with no session stays on /login without error', async () => {
    bootSession(null)
    function LogoutProbe() {
      const { logout } = useAuth()
      return (
        <button type="button" onClick={() => void logout()}>
          probe-logout
        </button>
      )
    }
    render(
      <LocaleProvider>
        <ToastProvider>
          <AuthProvider>
            <LogoutProbe />
          </AuthProvider>
        </ToastProvider>
      </LocaleProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'probe-logout' }))
    expect(screen.getByRole('button', { name: 'probe-logout' })).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })
})

/* ── R-UI-FND-1: localized login form, identical-401 ──────────────────── */

describe('R-UI-FND-1: localized login form', () => {
  function loginMockResponder() {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 401, body: err('UNAUTHORIZED') }
      if (req.path === '/api/auth/login') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
  }

  it('R-UI-FND-1: wrong password (ES) → exactly ONE neutral localized message, no field hint', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 401, body: err('UNAUTHORIZED') }
      if (req.path === '/api/auth/login') return { status: 401, body: err('UNAUTHORIZED') }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderAt('/login')

    await screen.findByLabelText('Usuario') // boot restore finished → form rendered
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Usuario'), 'admin')
    await user.type(screen.getByLabelText('Contraseña'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Usuario o contraseña inválidos')
    // no FIELD-level hints about which field failed (the message is generic)
    expect(document.querySelectorAll('.field-error')).toHaveLength(0)
  })

  it('R-UI-FND-1: valid credentials → token stored in memory, routes to the intended page', async () => {
    loginMockResponder()
    const router = renderAt('/login')

    await screen.findByLabelText('Usuario') // boot restore finished → form rendered
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Usuario'), 'admin')
    await user.type(screen.getByLabelText('Contraseña'), 'Secret123')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    await screen.findByRole('heading', { name: 'Panel' })
    expect(getAccessToken()).toBe('access-token-1')
    expect(router.state.location.pathname).toBe('/dashboard')
  })
})

/* ── R-AUTHUI-2: token memory-only ────────────────────────────────────── */

describe('R-AUTHUI-2: access token memory-only', () => {
  it('R-AUTHUI-2: after login, storage scan finds NO token keys (localStorage/sessionStorage)', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 401, body: err('UNAUTHORIZED') }
      if (req.path === '/api/auth/login') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderAt('/login')

    await screen.findByLabelText('Usuario') // boot restore finished → form rendered
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Usuario'), 'admin')
    await user.type(screen.getByLabelText('Contraseña'), 'Secret123')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    await screen.findByRole('heading', { name: 'Panel' })

    const localKeys = Object.keys(window.localStorage)
    const sessionKeys = Object.keys(window.sessionStorage)
    expect(localKeys.some((k) => /token|access/i.test(k))).toBe(false)
    expect(sessionKeys.some((k) => /token|access/i.test(k))).toBe(false)
    // the token lives in memory only
    expect(getAccessToken()).toBe('access-token-1')
  })
})

/* ── R-RBAC-1: route guard (viewer → /users) ──────────────────────────── */

describe('R-RBAC-1: route guards mirror backend permissions', () => {
  it('R-RBAC-1: viewer hits /users → redirect /dashboard + denial toast, NO /api/users request', async () => {
    bootSession('viewer')
    renderAt('/users')

    expect(await screen.findByText('No tienes permiso para acceder a esta sección')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Panel' })).toBeInTheDocument()
    expect(mock.requests.some((r) => r.path.startsWith('/api/users'))).toBe(false)
  })
})

/* ── R-UI-FND-2: role-aware sidebar ───────────────────────────────────── */

describe('R-UI-FND-2: sidebar role-aware navigation', () => {
  it('R-UI-FND-2: viewer sidebar = 6 read modules, zero write actions', async () => {
    bootSession('viewer')
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'Panel' })
    // scope to the sidebar nav — the dashboard body has its own links (R-UI-DSH-3)
    const sidebar = within(screen.getByRole('navigation'))

    for (const label of ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones']) {
      expect(sidebar.getByRole('link', { name: label })).toBeInTheDocument()
    }
    for (const label of ['Auditoría', 'Usuarios', 'Trabajos']) {
      expect(sidebar.queryByRole('link', { name: label })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /crear|editar|eliminar|desactivar/i })).toBeNull()
  })

  it('R-UI-FND-2: admin sidebar shows every module entry', async () => {
    bootSession('admin')
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'Panel' })
    const sidebar = within(screen.getByRole('navigation'))

    for (const label of ['Panel', 'Clientes', 'Productos', 'Stock', 'Pedidos', 'Notificaciones', 'Auditoría', 'Usuarios', 'Trabajos']) {
      expect(sidebar.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})

/* ── R-I18N-3: locale toggle pre/post auth + backend-wins-on-boot ─────── */

describe('R-I18N-3: LocaleToggle persistence and backend push', () => {
  it('R-I18N-3: pre-auth toggle persists to localStorage with NO API call', async () => {
    bootSession(null)
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Iniciar sesión' })

    const requestsBefore = mock.requests.length
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'EN' }))

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    expect(mock.requests.length).toBe(requestsBefore) // nothing new fired
  })

  it('R-I18N-3: post-auth toggle pushes PATCH /api/auth/me {locale}', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') {
        return { status: 200, body: loginResponseFixture({ role: 'admin', locale: 'es' }) }
      }
      if (req.path === '/api/auth/me' && req.method === 'PATCH') {
        return { status: 200, body: { user: { ...userFixture, locale: 'en' } } }
      }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'Panel' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'EN' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.path === '/api/auth/me' && r.method === 'PATCH')
      expect(patch).toBeDefined()
      expect(patch?.body).toEqual({ locale: 'en' })
    })
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })

  it('R-I18N-3: backend wins on boot — restored user locale overrides localStorage and corrects it', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') {
        return { status: 200, body: loginResponseFixture({ role: 'admin', locale: 'en' }) }
      }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    renderAt('/dashboard')

    await screen.findByRole('heading', { name: 'Dashboard' }) // EN UI after sync
    await waitFor(() => {
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    })
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('en')
  })
})