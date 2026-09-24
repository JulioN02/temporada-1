/**
 * T-5-1 (capstone-ui it5) — Notifications page tests (R-UI-NOT-1..3).
 * RED: imports NotificationsPage / modules/governance/* — the page is still a
 * placeholder and the governance module helpers do not exist yet.
 * Mock fetch is the single seam — no live backend (R-UI-NFR-6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthContext.tsx'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { ToastProvider } from '../src/components/ToastProvider.tsx'
import { Layout } from '../src/components/Layout.tsx'
import { NotificationsPage } from '../src/pages/NotificationsPage.tsx'
import { notificationTypeLabelKey, channelLabelKey } from '../src/modules/governance/notifications.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { loginResponseFixture, notificationFixture } from './__fixtures__/api.ts'
import type { Notification } from '../src/api/types.ts'

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

/** Full shell: sidebar (with the R-UI-NOT-3 badge) + the notifications page. */
function renderShell(initialEntries = ['/notifications']) {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={initialEntries}>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="dashboard" element={<div>Dashboard body</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/**
 * Stateful notifications mock: the badge endpoint
 * (/api/notifications?unreadOnly=true&limit=1) reports the live unread
 * count; mark-read flips the row's readAt and decrements it; the list
 * endpoint filters by unreadOnly (server-side semantics).
 */
function notificationsMock(seed: Notification[]) {
  const rows = seed.map((n) => ({ ...n }))
  let unread = rows.filter((n) => n.readAt === null).length

  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(req.path)) {
      const id = req.path.split('/')[3] ?? ''
      const row = rows.find((r) => r.id === id)
      if (!row) return { status: 404, body: err('NOT_FOUND') }
      if (row.readAt === null) {
        row.readAt = '2026-01-07T12:00:00.000Z'
        unread -= 1
      }
      return { status: 204 } // idempotent — already-read rows stay 204
    }
    if (req.method === 'GET' && req.path.startsWith('/api/notifications')) {
      const url = new URL(req.path, 'http://localhost')
      const unreadOnly = url.searchParams.get('unreadOnly')
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '10')
      if (unreadOnly === 'true' && limit === 1) {
        // R-UI-NOT-3 badge: pagination.total is the unread count
        return {
          status: 200,
          body: { data: [], pagination: { page, limit, total: unread, totalPages: Math.max(1, Math.ceil(unread / limit)) } },
        }
      }
      const filtered = unreadOnly === 'true' ? rows.filter((r) => r.readAt === null) : rows
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
  return rows
}

/* ── R-UI-NOT-1: list + unread filter + stored snapshot ──────────────── */

describe('R-UI-NOT-1: notifications list with unread filter', () => {
  it('R-UI-NOT-1: unreadOnly toggle → only unread rows render (request carries unreadOnly=true)', async () => {
    notificationsMock([
      notificationFixture({ id: '1', readAt: null }),
      notificationFixture({ id: '2', readAt: null }),
      notificationFixture({ id: '3', readAt: '2026-01-07T10:00:00.000Z' }),
    ])
    renderShell()
    // default view: 3 rows + header
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))
    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: 'Solo no leídas' }))
    // unreadOnly=true: 2 rows + header
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    const listReq = mock.requests.find((r) => r.method === 'GET' && r.path.includes('unreadOnly=true') && r.path.includes('page='))
    expect(listReq).toBeTruthy()
  })

  it('R-UI-NOT-1: stored snapshot renders verbatim — EN title while UI locale is es (no re-translation)', async () => {
    notificationsMock([
      notificationFixture({
        id: '1',
        type: 'order_confirmed',
        title: 'Order confirmed',
        body: 'Your order was confirmed.',
        readAt: null,
      }),
    ])
    renderShell()
    // the STORED title/body render as-is (R-BE-3 snapshot — never re-rendered)
    expect(await screen.findByText('Order confirmed')).toBeInTheDocument()
    expect(screen.getByText('Your order was confirmed.')).toBeInTheDocument()
    // the TYPE label IS localized through the catalog mapping
    expect(screen.getByText('Pedido confirmado')).toBeInTheDocument()
  })

  it('R-UI-NOT-1: empty unread list → localized empty state (no zero-row table)', async () => {
    notificationsMock([notificationFixture({ id: '1', readAt: '2026-01-07T10:00:00.000Z' })])
    renderShell()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Solo no leídas' }))
    expect(await screen.findByText('No hay notificaciones')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

/* ── R-UI-NOT-2: mark read, idempotent ────────────────────────────────── */

describe('R-UI-NOT-2: mark read, idempotent', () => {
  it('R-UI-NOT-2: mark one → POST /:id/read 204, row shows read immediately, badge decrements', async () => {
    notificationsMock([
      notificationFixture({ id: '1', readAt: null }),
      notificationFixture({ id: '2', readAt: null }),
      notificationFixture({ id: '3', readAt: '2026-01-07T10:00:00.000Z' }),
    ])
    renderShell()
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))
    const sidebar = within(screen.getByRole('navigation'))
    await waitFor(() => expect(sidebar.getByText('2')).toBeInTheDocument()) // badge = 2 unread

    const user = userEvent.setup()
    const firstRow = screen.getAllByRole('row')[1] as HTMLElement
    await user.click(within(firstRow).getByRole('button', { name: 'Marcar como leída' }))

    await waitFor(() => {
      // id 1 now read + fixture id 3 already read → two 'Leída' badges
      expect(within(screen.getByRole('table')).getAllByText('Leída')).toHaveLength(2)
    })
    expect(mock.requests.some((r) => r.method === 'POST' && r.path === '/api/notifications/1/read')).toBe(true)
    await waitFor(() => expect(sidebar.getByText('1')).toBeInTheDocument()) // badge decremented
  })

  it('R-UI-NOT-2: double mark on an already-read row → second POST 204, no visual change (idempotent)', async () => {
    notificationsMock([notificationFixture({ id: '1', readAt: null })])
    renderShell()
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    const user = userEvent.setup()
    const row = screen.getAllByRole('row')[1] as HTMLElement
    const button = within(row).getByRole('button', { name: 'Marcar como leída' })
    await user.click(button)
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Leída')).toBeInTheDocument())

    // click again on the now-read row → 204, no visual change, no error
    await user.click(within(screen.getAllByRole('row')[1] as HTMLElement).getByRole('button', { name: 'Marcar como leída' }))
    await waitFor(() => {
      const posts = mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/notifications/1/read')
      expect(posts).toHaveLength(2)
    })
    expect(within(screen.getByRole('table')).getByText('Leída')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/* ── R-UI-NOT-3: unread badge in the shell ────────────────────────────── */

describe('R-UI-NOT-3: unread badge in the sidebar', () => {
  it('R-UI-NOT-3: badge 5 → after 2 marks 3 → after all marks hidden (zero)', async () => {
    const rows = [
      notificationFixture({ id: '1', readAt: null }),
      notificationFixture({ id: '2', readAt: null }),
      notificationFixture({ id: '3', readAt: null }),
      notificationFixture({ id: '4', readAt: null }),
      notificationFixture({ id: '5', readAt: null }),
      notificationFixture({ id: '6', readAt: '2026-01-07T10:00:00.000Z' }),
      notificationFixture({ id: '7', readAt: '2026-01-07T11:00:00.000Z' }),
    ]
    notificationsMock(rows)
    renderShell()
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(8))
    const sidebar = within(screen.getByRole('navigation'))
    await waitFor(() => expect(sidebar.getByText('5')).toBeInTheDocument())

    const user = userEvent.setup()
    // mark the first two unread rows
    await user.click(within(screen.getAllByRole('row')[1] as HTMLElement).getByRole('button', { name: 'Marcar como leída' }))
    await user.click(within(screen.getAllByRole('row')[2] as HTMLElement).getByRole('button', { name: 'Marcar como leída' }))
    await waitFor(() => expect(sidebar.getByText('3')).toBeInTheDocument())

    // mark the remaining three
    for (let i = 3; i <= 5; i += 1) {
      await user.click(within(screen.getAllByRole('row')[i] as HTMLElement).getByRole('button', { name: 'Marcar como leída' }))
    }
    await waitFor(() => expect(sidebar.queryByText('3')).toBeNull())
    expect(sidebar.queryByText('0')).toBeNull() // hidden at zero
    // the badge request used limit=1 pagination.total (R-UI-NOT-3 contract)
    expect(mock.requests.some((r) => r.path === '/api/notifications?unreadOnly=true&limit=1')).toBe(true)
  })

  it('R-UI-NOT-3: badge refreshes on navigation (nav dependency refetch)', async () => {
    notificationsMock([notificationFixture({ id: '1', readAt: null })])
    renderShell()
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    const sidebar = within(screen.getByRole('navigation'))
    await waitFor(() => expect(sidebar.getByText('1')).toBeInTheDocument())

    const badgeRequestsBefore = mock.requests.filter((r) => r.path === '/api/notifications?unreadOnly=true&limit=1').length
    const user = userEvent.setup()
    await user.click(sidebar.getByRole('link', { name: 'Panel' }))
    await waitFor(() => {
      const badgeRequestsAfter = mock.requests.filter((r) => r.path === '/api/notifications?unreadOnly=true&limit=1').length
      expect(badgeRequestsAfter).toBeGreaterThan(badgeRequestsBefore)
    })
  })
})

/* ── Pure helpers (extract-before-mock) ───────────────────────────────── */

describe('notifications pure helpers', () => {
  it('maps all 7 backend types to localized label keys', () => {
    expect(notificationTypeLabelKey('order_confirmed')).toBe('notifications.type.orderConfirmed')
    expect(notificationTypeLabelKey('order_cancelled')).toBe('notifications.type.orderCancelled')
    expect(notificationTypeLabelKey('low_stock')).toBe('notifications.type.lowStock')
    expect(notificationTypeLabelKey('stock_adjusted')).toBe('notifications.type.stockAdjusted')
    expect(notificationTypeLabelKey('stock_transferred')).toBe('notifications.type.stockTransferred')
    expect(notificationTypeLabelKey('user_invited')).toBe('notifications.type.userInvited')
    expect(notificationTypeLabelKey('job_failed')).toBe('notifications.type.jobFailed')
  })

  it('unknown type → null (render raw, no silent assumption)', () => {
    expect(notificationTypeLabelKey('order_exported')).toBeNull()
  })

  it('maps channels to localized label keys; unknown → null', () => {
    expect(channelLabelKey('in_app')).toBe('notifications.channel.inApp')
    expect(channelLabelKey('email')).toBe('notifications.channel.email')
    expect(channelLabelKey('sms')).toBeNull()
  })
})