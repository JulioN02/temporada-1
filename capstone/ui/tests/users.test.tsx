/**
 * T-5-3 + T-5-4 (capstone-ui it5) — Users page tests (R-UI-USR-1..3).
 * RED: imports UsersPage / modules/governance/userForm.* — page is a
 * placeholder, the form validation module does not exist yet.
 * Mock fetch single seam — no live backend (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { LocaleBackendSync } from '../src/components/LocaleBackendSync.tsx'
import { appRoutes } from '../src/App.tsx'
import { UsersPage } from '../src/pages/UsersPage.tsx'
import { validateUsername, validatePassword, validateEmail } from '../src/modules/governance/userForm.ts'
import { translate } from '../src/i18n/useTranslation.ts'
import { es } from '../src/i18n/locales/es.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture } from './__fixtures__/api.ts'
import type { PublicUser } from '../src/api/types.ts'

let mock: MockFetchHandle

const err = (code: string) => ({ error: { code, message: code } })

const adminUser: PublicUser = {
  id: '1',
  username: 'admin',
  fullName: 'Admin User',
  email: 'admin@bop.local',
  role: 'admin',
  active: true,
  locale: 'es',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const managerUser: PublicUser = {
  id: '2',
  username: 'manager',
  fullName: 'Manager User',
  email: 'manager@bop.local',
  role: 'manager',
  active: true,
  locale: 'es',
  createdAt: '2026-01-02T00:00:00.000Z',
}
const inactiveUser: PublicUser = {
  id: '3',
  username: 'inactive',
  fullName: 'Inactive User',
  email: 'inactive@bop.local',
  role: 'viewer',
  active: false,
  locale: 'en',
  createdAt: '2026-01-03T00:00:00.000Z',
}

beforeEach(() => {
  setAccessToken(null)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function renderUsers() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/users']}>
            <Routes>
              <Route path="/users" element={<UsersPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/** Stateful users mock: list, create (409 on duplicate), PATCH per row. */
function usersMock(seed: PublicUser[]) {
  const rows = seed.map((u) => ({ ...u }))
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/users')) {
      return {
        status: 200,
        body: { data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } },
      }
    }
    if (req.method === 'POST' && req.path === '/api/users') {
      const body = req.body as { username?: string }
      if (body.username === 'admin') return { status: 409, body: err('USERNAME_TAKEN') }
      return { status: 201, body: { user: adminUser } }
    }
    if (req.method === 'PATCH' && /^\/api\/users\/[^/]+$/.test(req.path)) {
      const id = req.path.split('/')[3] ?? ''
      const row = rows.find((r) => r.id === id)
      if (!row) return { status: 404, body: err('NOT_FOUND') }
      Object.assign(row, req.body as Partial<PublicUser>)
      return { status: 200, body: { user: row } }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
  return rows
}

/* ── R-UI-USR-1: users list (admin only) ──────────────────────────────── */

describe('R-UI-USR-1: users list', () => {
  it('R-UI-USR-1: rows render username/fullName/email + role/active badges + pagination', async () => {
    usersMock([adminUser, managerUser, inactiveUser])
    renderUsers()
    await screen.findByRole('table')
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('Admin User')).toBeInTheDocument()
    expect(screen.getByText('admin@bop.local')).toBeInTheDocument()
    expect(screen.getByText('Administrador')).toBeInTheDocument() // localized role badge
    expect(screen.getByText('Encargado')).toBeInTheDocument()
    // 'Activo' appears as the column header + the two active-row badges
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Activo')).toHaveLength(3)
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
    // pagination rendered when totalPages > 1
    expect(screen.queryByRole('navigation', { name: 'pagination' })).toBeNull()
  })

  it('R-UI-USR-1: manager /users → redirect + denial toast, NO request (no auth:user_read)', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'manager' }) }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/users'] })
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
    expect(mock.requests.some((r) => r.path.startsWith('/api/users'))).toBe(false)
  })
})

/* ── R-UI-USR-2: create/invite user (NO locale field, password strength) ─ */

describe('R-UI-USR-2: create/invite user', () => {
  it('R-UI-USR-2: create form renders NO locale field (locale is self-service only)', async () => {
    usersMock([adminUser])
    renderUsers()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Crear usuario' }))
    await screen.findByRole('dialog')
    expect(screen.getByLabelText('Usuario')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre completo')).toBeInTheDocument()
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument()
    expect(screen.getByLabelText('Rol')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
    // NO locale/idioma input — asserted (R-UI-USR-2 locked delta)
    expect(screen.queryByLabelText(/idioma|locale/i)).toBeNull()
  })

  it('R-UI-USR-2: weak password "abc" → client-side localized error, NO request', async () => {
    usersMock([adminUser])
    renderUsers()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Crear usuario' }))
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Usuario'), 'newuser')
    await user.type(screen.getByLabelText('Nombre completo'), 'New User')
    await user.type(screen.getByLabelText('Correo electrónico'), 'new@bop.local')
    await user.type(screen.getByLabelText('Contraseña'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('La contraseña debe tener al menos 12 caracteres, una letra y un dígito')).toBeInTheDocument()
    expect(mock.requests.some((r) => r.method === 'POST' && r.path === '/api/users')).toBe(false)
  })

  it('R-UI-USR-2: valid payload → 201, invitation toast (password never echoed), NO locale in body', async () => {
    usersMock([adminUser])
    renderUsers()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Crear usuario' }))
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Usuario'), 'newuser')
    await user.type(screen.getByLabelText('Nombre completo'), 'New User')
    await user.type(screen.getByLabelText('Correo electrónico'), 'new@bop.local')
    await user.type(screen.getByLabelText('Contraseña'), 'Str0ngPassw0rd')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Invitación enviada')).toBeInTheDocument()
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/users')
    expect(post).toBeTruthy()
    expect(post?.body).toEqual({
      username: 'newuser',
      fullName: 'New User',
      email: 'new@bop.local',
      role: 'viewer',
      password: 'Str0ngPassw0rd',
    })
    // locale NOT part of the payload (R-UI-USR-2 locked delta)
    expect(post?.body).not.toHaveProperty('locale')
    // the password is never echoed in the DOM (R-UI-USR-2 / R-AUD-3 hygiene)
    expect(document.body.textContent).not.toContain('Str0ngPassw0rd')
  })

  it('R-UI-USR-2: duplicate username → localized 409, form stays open and intact', async () => {
    usersMock([adminUser])
    renderUsers()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Crear usuario' }))
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Usuario'), 'admin')
    await user.type(screen.getByLabelText('Correo electrónico'), 'dup@bop.local')
    await user.type(screen.getByLabelText('Contraseña'), 'Str0ngPassw0rd')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El nombre de usuario ya está en uso')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument() // form intact
    expect((screen.getByLabelText('Usuario') as HTMLInputElement).value).toBe('admin')
  })
})

/* ── R-UI-USR-3: edit user — role change + activate/deactivate ────────── */

describe('R-UI-USR-3: edit user', () => {
  it('R-UI-USR-3: deactivate another user → confirm gate → PATCH {active:false}, row shows inactive', async () => {
    const rows = usersMock([adminUser, managerUser, inactiveUser])
    renderUsers()
    await screen.findByRole('table')
    const user = userEvent.setup()
    // find the manager row's Deactivate button (row-scoped)
    const managerRow = screen.getAllByRole('row').find((row) => within(row).queryByText('manager'))
    expect(managerRow).toBeTruthy()
    await user.click(within(managerRow as HTMLElement).getByRole('button', { name: 'Desactivar' }))
    await user.click(within(managerRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/users/2')
      expect(patch?.body).toEqual({ active: false })
    })
    const updated = rows.find((r) => r.id === '2')
    expect(updated?.active).toBe(false)
    await waitFor(() => {
      const row = screen.getAllByRole('row').find((r) => within(r).queryByText('manager'))
      expect(within(row as HTMLElement).getByText('Inactivo')).toBeInTheDocument()
    })
  })

  it('R-UI-USR-3: self-deactivation blocked client-side — warning, ZERO requests', async () => {
    usersMock([adminUser, managerUser])
    renderUsers()
    await screen.findByRole('table')
    const user = userEvent.setup()
    const adminRow = screen.getAllByRole('row').find((row) => within(row).queryByText('admin'))
    expect(adminRow).toBeTruthy()
    await user.click(within(adminRow as HTMLElement).getByRole('button', { name: 'Desactivar' }))
    await user.click(within(adminRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('No puedes desactivar tu propia cuenta')).toBeInTheDocument()
    // zero PATCH requests for the self row
    expect(mock.requests.filter((r) => r.method === 'PATCH' && r.path === '/api/users/1')).toHaveLength(0)
  })

  it('R-UI-USR-3: role change → PATCH {role} and the row badge updates', async () => {
    const rows = usersMock([adminUser, managerUser])
    renderUsers()
    await screen.findByRole('table')
    const user = userEvent.setup()
    const managerRow = screen.getAllByRole('row').find((row) => within(row).queryByText('manager'))
    expect(managerRow).toBeTruthy()
    await user.click(within(managerRow as HTMLElement).getByRole('button', { name: 'Editar' }))
    await screen.findByRole('dialog')
    await user.selectOptions(screen.getByLabelText('Rol'), 'viewer')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const patch = mock.requests.find((r) => r.method === 'PATCH' && r.path === '/api/users/2')
      expect(patch?.body).toEqual({ role: 'viewer' })
    })
    const updated = rows.find((r) => r.id === '2')
    expect(updated?.role).toBe('viewer')
    await waitFor(() => {
      const row = screen.getAllByRole('row').find((r) => within(r).queryByText('manager'))
      expect(within(row as HTMLElement).getByText('Espectador')).toBeInTheDocument()
    })
  })
})

/* ── Pure helpers (extract-before-mock) ───────────────────────────────── */

describe('user form validation', () => {
  const tEs = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(es, key, params)

  it('validateUsername: 3-50 chars, [A-Za-z0-9_] only', () => {
    expect(validateUsername('ab', tEs)).toBe('El usuario debe tener entre 3 y 50 caracteres y solo letras, números y guiones bajos')
    expect(validateUsername('valid_user1', tEs)).toBeNull()
    expect(validateUsername('has space', tEs)).not.toBeNull()
    expect(validateUsername('has-é', tEs)).not.toBeNull()
  })

  it('validatePassword: 12-128 chars with a letter and a digit', () => {
    expect(validatePassword('abc', tEs)).toBe('La contraseña debe tener al menos 12 caracteres, una letra y un dígito')
    expect(validatePassword('alllettersonly', tEs)).not.toBeNull() // no digit
    expect(validatePassword('123456789012', tEs)).not.toBeNull() // no letter
    expect(validatePassword('Str0ngPassw0rd', tEs)).toBeNull()
  })

  it('validateEmail: basic format', () => {
    expect(validateEmail('user@example.com', tEs)).toBeNull()
    expect(validateEmail('not-an-email', tEs)).toBe('El correo electrónico no es válido')
  })
})