/**
 * T-2-9 / T-2-10 (capstone-ui it2b) — shared components + hooks tests
 * (R-UI-FND-3/4). RED: imports DataTable / Pagination / Modal / ConfirmButton
 * / MoneyText / hooks — none exist yet. Mock fetch is the single seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx'
import { DataTable } from '../src/components/DataTable.tsx'
import type { Column } from '../src/components/DataTable.tsx'
import { Pagination } from '../src/components/Pagination.tsx'
import { Modal } from '../src/components/Modal.tsx'
import { ConfirmButton } from '../src/components/ConfirmButton.tsx'
import { MoneyText } from '../src/components/MoneyText.tsx'
import { api, setAccessToken } from '../src/api/client.ts'
import { useResource } from '../src/hooks/useResource.ts'
import { usePagination } from '../src/hooks/usePagination.ts'
import { useDebouncedValue } from '../src/hooks/useDebouncedValue.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import { customerFixture, orderFixture, paginated } from './__fixtures__/api.ts'
import type { Customer, Order, Paginated } from '../src/api/types.ts'

let mock: MockFetchHandle

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  vi.useRealTimers()
})

const columns: Column<Customer>[] = [
  { key: 'name', header: 'Nombre' },
  { key: 'email', header: 'Correo' },
]

/* ── R-UI-FND-3: loading / empty / error states ───────────────────────── */

describe('R-UI-FND-3: DataTable states (loading, empty, error, data)', () => {
  it('R-UI-FND-3: empty list → localized empty state, NOT a zero-row table', () => {
    render(
      <LocaleProvider>
        <DataTable columns={columns} rows={[]} keyOf={(row) => row.id} />
      </LocaleProvider>,
    )
    expect(screen.getByText('No hay registros')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('R-UI-FND-3: loading → localized loading state', () => {
    render(
      <LocaleProvider>
        <DataTable columns={columns} rows={[]} keyOf={(row) => row.id} loading />
      </LocaleProvider>,
    )
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('R-UI-FND-3: error → localized error state; retry re-fetches (onRetry fired)', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <DataTable
          columns={columns}
          rows={[]}
          keyOf={(row) => row.id}
          error="Ocurrió un error al cargar los datos"
          onRetry={onRetry}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText('Ocurrió un error al cargar los datos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('R-UI-FND-3: data renders rows and cells', () => {
    render(
      <LocaleProvider>
        <DataTable columns={columns} rows={[customerFixture()]} keyOf={(row) => row.id} />
      </LocaleProvider>,
    )
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument()
    expect(screen.getByText('ana@example.com')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

/* ── R-UI-FND-4: Idempotency-Key semantics at the component level ─────── */

describe('R-UI-FND-4: idempotent mutation submit', () => {
  it('R-UI-FND-4: double-click same key → ONE row (200 replay treated as success, no double-render)', async () => {
    let calls = 0
    mock = createMockFetch(() => {
      calls += 1
      return calls === 1
        ? { status: 201, body: { order: orderFixture() } }
        : { status: 200, body: { order: orderFixture() } }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    function CreateHarness() {
      const [rows, setRows] = useState<string[]>([])
      const keyRef = useRef(`uuid-${Date.now()}`)
      async function create(): Promise<void> {
        const { status, data } = await api.postWithStatus<{ order: Order }>(
          '/api/orders',
          { customerId: '10', lines: [] },
          { 'Idempotency-Key': keyRef.current },
        )
        // 201 = created → append; 200 = idempotent replay → already present
        if (status === 201) setRows((prev) => [...prev, data.order.id])
      }
      return (
        <div>
          <button type="button" onClick={() => void create()}>
            Crear pedido
          </button>
          <ul>
            {rows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
      )
    }

    render(<CreateHarness />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Crear pedido' })
    await user.click(button)
    await user.click(button)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(mock.requests).toHaveLength(2)
    const keys = new Set(mock.requests.map((r) => r.headers.get('idempotency-key')))
    expect(keys.size).toBe(1) // same key both times
  })

  it('R-UI-FND-4: fresh key per submit — two separate actions send two distinct keys, two rows', async () => {
    mock = createMockFetch(() => ({ status: 201, body: { order: orderFixture() } }))
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    function CreateHarness() {
      const [rows, setRows] = useState<string[]>([])
      const keyRef = useRef(0)
      async function create(): Promise<void> {
        keyRef.current += 1
        const { status, data } = await api.postWithStatus<{ order: Order }>(
          '/api/orders',
          { customerId: '10', lines: [] },
          { 'Idempotency-Key': `key-${keyRef.current}` },
        )
        if (status === 201) setRows((prev) => [...prev, data.order.id])
      }
      return (
        <div>
          <button type="button" onClick={() => void create()}>
            Crear pedido
          </button>
          <ul>
            {rows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
      )
    }

    render(<CreateHarness />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Crear pedido' })
    await user.click(button)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    await user.click(button)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))

    const keys = mock.requests.map((r) => r.headers.get('idempotency-key'))
    expect(new Set(keys).size).toBe(2)
  })
})

/* ── Modal ────────────────────────────────────────────────────────────── */

describe('Modal: dialog semantics', () => {
  it('Modal: renders content, moves focus inside, ESC closes', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <Modal title="Editar cliente" onClose={onClose}>
          <input aria-label="Nombre" />
        </Modal>
      </LocaleProvider>,
    )
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()
    // focus trap: the first focusable inside the dialog receives focus
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Modal: backdrop click closes, inner click does not', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <Modal title="T" onClose={onClose}>
          <button type="button">inner</button>
        </Modal>
      </LocaleProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'inner' }))
    expect(onClose).not.toHaveBeenCalled()
    const backdrop = document.querySelector('.modal-backdrop')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/* ── ConfirmButton (two-step gate) ────────────────────────────────────── */

describe('ConfirmButton: two-step gate', () => {
  it('ConfirmButton: arm → cancel fires nothing', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <ConfirmButton label="Desactivar" onConfirm={onConfirm} />
      </LocaleProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ConfirmButton: arm → confirm fires exactly once', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <ConfirmButton label="Desactivar" onConfirm={onConfirm} />
      </LocaleProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Desactivar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

/* ── Pagination / MoneyText ───────────────────────────────────────────── */

describe('Pagination and MoneyText', () => {
  it('Pagination: page info + disabled prev at page 1; next fires onPageChange(2)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <Pagination page={1} totalPages={3} onPageChange={onChange} />
      </LocaleProvider>,
    )
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('MoneyText: D13 "12.50" renders es "12,50 €"', () => {
    render(
      <LocaleProvider>
        <MoneyText value="12.50" />
      </LocaleProvider>,
    )
    expect(screen.getByText('12,50 €')).toBeInTheDocument()
  })
})

/* ── hooks: useResource / usePagination / useDebouncedValue ───────────── */

describe('hooks', () => {
  it('useResource: loading → data → error on refetch (re-fetch)', async () => {
    let calls = 0
    mock = createMockFetch(() => {
      calls += 1
      return calls === 1
        ? { status: 200, body: paginated([customerFixture()]) }
        : { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } }
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    function ResourceProbe() {
      const { data, loading, error, refetch } = useResource(
        () => api.get<Paginated<Customer>>('/api/customers'),
        [],
      )
      if (loading) return <div>loading</div>
      if (error) return (
        <div>
          <span>error</span>
          <button type="button" onClick={refetch}>
            refetch
          </button>
        </div>
      )
      return (
        <div>
          <span>{data?.data.map((customer) => customer.name).join(',')}</span>
          <button type="button" onClick={refetch}>
            refetch
          </button>
        </div>
      )
    }

    render(<ResourceProbe />)
    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'refetch' }))
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('usePagination: next / prev / reset with bounds', () => {
    function PaginationProbe() {
      const { page, next, prev, reset } = usePagination({ page: 2 })
      return (
        <div>
          <span data-testid="page">{page}</span>
          <button type="button" onClick={next}>
            next
          </button>
          <button type="button" onClick={prev}>
            prev
          </button>
          <button type="button" onClick={reset}>
            reset
          </button>
        </div>
      )
    }
    render(<PaginationProbe />)
    expect(screen.getByTestId('page')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByTestId('page')).toHaveTextContent('3')
    fireEvent.click(screen.getByRole('button', { name: 'prev' }))
    expect(screen.getByTestId('page')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(screen.getByTestId('page')).toHaveTextContent('1')
  })

  it('useDebouncedValue: value updates only after the delay', () => {
    vi.useFakeTimers()
    function DebounceProbe() {
      const [value, setValue] = useState('a')
      const debounced = useDebouncedValue(value, 200)
      return (
        <div>
          <span data-testid="debounced">{debounced}</span>
          <button type="button" onClick={() => setValue('b')}>
            set
          </button>
        </div>
      )
    }
    render(<DebounceProbe />)
    expect(screen.getByTestId('debounced')).toHaveTextContent('a')
    fireEvent.click(screen.getByRole('button', { name: 'set' }))
    expect(screen.getByTestId('debounced')).toHaveTextContent('a') // not yet
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByTestId('debounced')).toHaveTextContent('b')
  })
})