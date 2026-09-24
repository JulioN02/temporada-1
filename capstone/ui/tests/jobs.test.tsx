/**
 * T-5-5 (capstone-ui it5) — Jobs page tests (R-UI-JOB-1..2).
 * RED: imports JobsPage / modules/governance/jobs.* — page is a placeholder,
 * the state-label module does not exist yet. Mock fetch single seam.
 * NOTE: server-side state/queue filters came from it1 (T-1-7) — the UI sends
 * the query params, never filters client-side (R-UI-JOB-1 resolved).
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
import { JobsPage } from '../src/pages/JobsPage.tsx'
import { jobStateLabelKey } from '../src/modules/governance/jobs.ts'
import { setAccessToken } from '../src/api/client.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { jobFixture, loginResponseFixture } from './__fixtures__/api.ts'
import type { Job, JobState } from '../src/api/types.ts'

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

function renderJobs() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/jobs']}>
            <Routes>
              <Route path="/jobs" element={<JobsPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  )
}

/** Stateful jobs mock: server-side state+queue filters + retry endpoint. */
function jobsMock(seed: Job[], retry404: ReadonlySet<string> = new Set()) {
  const rows = seed.map((j) => ({ ...j }))
  mock = createMockFetch((req) => {
    if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'admin' }) }
    if (req.method === 'GET' && req.path.startsWith('/api/jobs')) {
      const url = new URL(req.path, 'http://localhost')
      const state = url.searchParams.get('state')
      const queue = url.searchParams.get('queue')
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '20')
      let filtered = rows
      if (state) filtered = filtered.filter((j) => j.state === state)
      if (queue) filtered = filtered.filter((j) => j.queue === queue)
      return {
        status: 200,
        body: {
          data: filtered,
          pagination: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) },
        },
      }
    }
    if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/retry$/.test(req.path)) {
      const id = req.path.split('/')[3] ?? ''
      if (retry404.has(id)) return { status: 404, body: err('NOT_FOUND') }
      const row = rows.find((j) => j.id === id)
      if (!row) return { status: 404, body: err('NOT_FOUND') }
      row.state = 'active' // requeued → active
      return { status: 200, body: { job: row } }
    }
    return { status: 404, body: err('NOT_FOUND') }
  })
  vi.stubGlobal('fetch', mock.fetchMock)
  return rows
}

const failed = jobFixture({ id: '1', queue: 'report.queue', state: 'failed', retryCount: 3, retryLimit: 5 })
const completed = jobFixture({ id: '2', queue: 'report.queue', state: 'completed', retryCount: 0, retryLimit: 5 })
const active = jobFixture({ id: '3', queue: 'email.queue', state: 'active', retryCount: 1, retryLimit: 5 })

/* ── R-UI-JOB-1: jobs list with server-side filters ───────────────────── */

describe('R-UI-JOB-1: jobs list', () => {
  it('R-UI-JOB-1: renders id/queue/state/attempts; localized state labels (Fallido/Completado/Activo)', async () => {
    jobsMock([failed, completed, active])
    renderJobs()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('1')).toBeInTheDocument()
    expect(within(table).getAllByText('report.queue')).toHaveLength(2)
    expect(within(table).getByText('email.queue')).toBeInTheDocument()
    expect(within(table).getByText('Fallido')).toBeInTheDocument()
    expect(within(table).getByText('Completado')).toBeInTheDocument()
    expect(within(table).getByText('Activo')).toBeInTheDocument()
    expect(within(table).getByText('3/5')).toBeInTheDocument() // attempts = retryCount/retryLimit
    expect(within(table).getByText('0/5')).toBeInTheDocument()
  })

  it('R-UI-JOB-1: failed rows are visually distinct — retry action present only on failed rows', async () => {
    jobsMock([failed, completed, active])
    renderJobs()
    const table = await screen.findByRole('table')
    const failedRow = within(table).getAllByRole('row').find((row) => within(row).queryByText('Fallido'))
    expect(failedRow).toBeTruthy()
    expect(within(failedRow as HTMLElement).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    const completedRow = within(table).getAllByRole('row').find((row) => within(row).queryByText('Completado'))
    expect(within(completedRow as HTMLElement).queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('R-UI-JOB-1: state filter issues the server-side query param (state=failed)', async () => {
    jobsMock([failed, completed, active])
    renderJobs()
    await screen.findByRole('table')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Estado'), 'failed')
    await waitFor(() => {
      const req = mock.requests.find((r) => r.method === 'GET' && r.path.includes('state=failed'))
      expect(req).toBeTruthy()
    })
    await waitFor(() => {
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      expect(rows).toHaveLength(2) // header + only the failed row
    })
    const tableAfter = screen.getByRole('table')
    expect(within(tableAfter).queryByText('Completado')).toBeNull()
  })

  it('R-UI-JOB-1: queue filter issues the server-side query param (queue=email.queue)', async () => {
    jobsMock([failed, completed, active])
    renderJobs()
    await screen.findByRole('table')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Cola'), 'email.queue')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    await waitFor(() => {
      const req = mock.requests.find((r) => r.method === 'GET' && r.path.includes('queue=email.queue'))
      expect(req).toBeTruthy()
    })
    await waitFor(() => {
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      expect(rows).toHaveLength(2)
    })
    expect(within(screen.getByRole('table')).queryByText('Fallido')).toBeNull()
  })

  it('R-UI-JOB-1: empty filtered result → localized empty state', async () => {
    jobsMock([failed])
    renderJobs()
    await screen.findByRole('table')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Estado'), 'completed')
    expect(await screen.findByText('No hay trabajos')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('R-UI-JOB-1: operator /jobs → redirect + denial toast, NO request (no jobs:job_read)', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') return { status: 200, body: loginResponseFixture({ role: 'operator' }) }
      return { status: 404, body: err('NOT_FOUND') }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/jobs'] })
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
    expect(mock.requests.some((r) => r.path.startsWith('/api/jobs'))).toBe(false)
  })
})

/* ── R-UI-JOB-2: retry (confirm-gated) ────────────────────────────────── */

describe('R-UI-JOB-2: retry job', () => {
  it('R-UI-JOB-2: confirm-gated retry → POST /retry fires, toast "Trabajo reencolado", row refreshes', async () => {
    const rows = jobsMock([failed, completed, active])
    renderJobs()
    await screen.findByRole('table')
    const user = userEvent.setup()
    const failedRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Fallido'))
    await user.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    await user.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Trabajo reencolado')).toBeInTheDocument()
    const retryReq = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/jobs/1/retry')
    expect(retryReq).toBeTruthy()
    // row refreshes: the mock requeued the job to 'active'
    const updated = rows.find((j) => j.id === '1')
    expect(updated?.state).toBe('active')
    await waitFor(() => {
      // two 'Activo' badges: the pre-existing active job (id 3) + the requeued one (id 1)
      const actives = within(screen.getByRole('table')).getAllByText('Activo')
      expect(actives).toHaveLength(2)
    })
  })

  it('R-UI-JOB-2: retry gate cancel → NO request', async () => {
    jobsMock([failed, completed])
    renderJobs()
    await screen.findByRole('table')
    const user = userEvent.setup()
    const failedRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Fallido'))
    await user.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    await user.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Cancelar' }))
    expect(mock.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/retry'))).toHaveLength(0)
  })

  it('R-UI-JOB-2: unknown/stale row id → localized 404, list refreshes', async () => {
    jobsMock([failed, completed], new Set(['1']))
    renderJobs()
    await screen.findByRole('table')
    const user = userEvent.setup()
    const failedRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Fallido'))
    await user.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    await user.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Trabajo no encontrado')).toBeInTheDocument()
    expect(mock.requests.some((r) => r.method === 'POST' && r.path === '/api/jobs/1/retry')).toBe(true)
  })
})

/* ── Pure helper (extract-before-mock) ────────────────────────────────── */

describe('jobStateLabelKey', () => {
  it('maps all 6 real pg-boss states to localized label keys', () => {
    const states: readonly JobState[] = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed']
    const expected: Record<JobState, string> = {
      created: 'jobs.state.created',
      retry: 'jobs.state.retry',
      active: 'jobs.state.active',
      completed: 'jobs.state.completed',
      cancelled: 'jobs.state.cancelled',
      failed: 'jobs.state.failed',
    }
    for (const state of states) {
      expect(jobStateLabelKey(state)).toBe(expected[state])
    }
  })
})