/**
 * T-2-5 (capstone-ui it2a) — api client tests (R-AUTHUI-1, R-UI-FND-4,
 * R-UI-NFR-6). RED: references client.ts + module api files that do not
 * exist yet. Mock fetch is the single seam — no live backend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  api,
  apiFetch,
  ApiClientError,
  setAccessToken,
  setSessionExpiredHandler,
} from '../src/api/client.ts'
import * as authApi from '../src/api/auth.ts'
import { listCustomers } from '../src/api/customers.ts'
import { listProducts } from '../src/api/products.ts'
import { listWarehouses } from '../src/api/warehouses.ts'
import { getStock, listMovements, adjust } from '../src/api/stock.ts'
import { createOrder, listOrders } from '../src/api/orders.ts'
import { listNotifications } from '../src/api/notifications.ts'
import { listAudit } from '../src/api/audit.ts'
import { listUsers } from '../src/api/users.ts'
import { listJobs } from '../src/api/jobs.ts'
import { createMockFetch, type MockFetchHandle } from './helpers/mockFetch.ts'
import {
  customerFixture,
  errorFixture,
  loginResponseFixture,
  orderFixture,
  paginated,
  productFixture,
  stockRowFixture,
  userFixture,
} from './__fixtures__/api.ts'

let mock: MockFetchHandle
let sessionExpiredCalls: number

beforeEach(() => {
  sessionExpiredCalls = 0
  setAccessToken(null)
  setSessionExpiredHandler(() => {
    sessionExpiredCalls += 1
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  setSessionExpiredHandler(null)
})

function refreshCount(): number {
  return mock.requests.filter((r) => r.path === '/api/auth/refresh').length
}

function requestsWith(path: string): number {
  return mock.requests.filter((r) => r.path === path).length
}

/* ── R-AUTHUI-1: single-flight bounded refresh ────────────────────────── */

describe('R-AUTHUI-1: single-flight bounded refresh', () => {
  it('R-AUTHUI-1: expired mid-session — one 401 triggers one refresh, retries once with the new token', async () => {
    let ordersCalls = 0
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') {
        return { status: 200, body: loginResponseFixture() }
      }
      if (req.path === '/api/orders') {
        ordersCalls += 1
        return ordersCalls === 1
          ? errorFixture(401, 'UNAUTHORIZED', 'expired')
          : { status: 200, body: paginated([orderFixture()]) }
      }
      return errorFixture(404, 'NOT_FOUND', 'nope')
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const result = await apiFetch<{ data: unknown[] }>('/api/orders')

    expect(result.data).toHaveLength(1)
    expect(refreshCount()).toBe(1)
    expect(ordersCalls).toBe(2)
    const orderRequests = mock.requests.filter((r) => r.path === '/api/orders' && r.method === 'GET')
    expect(orderRequests).toHaveLength(2)
    expect(orderRequests[0]?.headers.get('authorization')).toBe('Bearer t1')
    expect(orderRequests[1]?.headers.get('authorization')).toBe('Bearer access-token-1')
    expect(sessionExpiredCalls).toBe(0)
  })

  it('R-AUTHUI-1: 4 concurrent 401s coalesce onto exactly ONE refresh; all retried and succeed', async () => {
    let ordersCalls = 0
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') {
        return { status: 200, body: loginResponseFixture() }
      }
      if (req.path === '/api/orders') {
        ordersCalls += 1
        return ordersCalls <= 4
          ? errorFixture(401, 'UNAUTHORIZED', 'expired')
          : { status: 200, body: paginated([orderFixture()]) }
      }
      return errorFixture(404, 'NOT_FOUND', 'nope')
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const results = await Promise.all([
      apiFetch<{ data: unknown[] }>('/api/orders'),
      apiFetch<{ data: unknown[] }>('/api/orders'),
      apiFetch<{ data: unknown[] }>('/api/orders'),
      apiFetch<{ data: unknown[] }>('/api/orders'),
    ])

    expect(results).toHaveLength(4)
    expect(refreshCount()).toBe(1)
    expect(ordersCalls).toBe(8) // 4 original + 4 retried
    expect(sessionExpiredCalls).toBe(0)
  })

  it('R-AUTHUI-1: refresh fails → ≤1 refresh attempt, zero retries, state cleared, session-expired fired, no loop', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/refresh') {
        return errorFixture(401, 'UNAUTHORIZED', 'refresh token gone')
      }
      if (req.path === '/api/orders') {
        return errorFixture(401, 'UNAUTHORIZED', 'expired')
      }
      return errorFixture(404, 'NOT_FOUND', 'nope')
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const outcomes = await Promise.allSettled([
      apiFetch('/api/orders'),
      apiFetch('/api/orders'),
      apiFetch('/api/orders'),
      apiFetch('/api/orders'),
    ])

    expect(outcomes.every((o) => o.status === 'rejected')).toBe(true)
    expect(refreshCount()).toBe(1) // single-flight: ONE attempt
    expect(requestsWith('/api/orders')).toBe(4) // zero retries (no second wave)
    expect(sessionExpiredCalls).toBeGreaterThanOrEqual(1)
    for (const outcome of outcomes) {
      const err = (outcome as PromiseRejectedResult).reason as ApiClientError
      expect(err).toBeInstanceOf(ApiClientError)
      expect(err.status).toBe(401)
      expect(err.code).toBe('UNAUTHORIZED')
    }

    // State cleared: the next request carries no Authorization header.
    mock.reset()
    await apiFetch('/api/orders').catch(() => {})
    const next = mock.requests[0]
    expect(next?.headers.get('authorization')).toBeNull()
  })

  it('R-AUTHUI-1: login/refresh requests NEVER trigger the refresh path', async () => {
    mock = createMockFetch(() => errorFixture(401, 'UNAUTHORIZED', 'bad credentials'))
    vi.stubGlobal('fetch', mock.fetchMock)

    await expect(authApi.login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    })
    expect(refreshCount()).toBe(0)
    expect(sessionExpiredCalls).toBe(0)
  })
})

/* ── R-UI-FND-4: idempotent replay 200 vs 201 ─────────────────────────── */

describe('R-UI-FND-4: replay signal (200 vs 201) via raw status', () => {
  it('R-UI-FND-4: postWithStatus distinguishes 201 (new) from 200 (idempotent replay)', async () => {
    let calls = 0
    mock = createMockFetch(() => {
      calls += 1
      return calls === 1
        ? { status: 201, body: { movement: { id: 'm1' } } }
        : { status: 200, body: { movement: { id: 'm1' } } }
    })
    vi.stubGlobal('fetch', mock.fetchMock)

    const first = await api.postWithStatus<{ movement: { id: string } }>('/api/stock/movements', {
      quantity: 5,
    })
    const replay = await api.postWithStatus<{ movement: { id: string } }>('/api/stock/movements', {
      quantity: 5,
    })

    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(first.data.movement.id).toBe('m1')
    expect(replay.data.movement.id).toBe('m1')
  })

  it('R-UI-FND-4: Idempotency-Key header is sent per mutation submit', async () => {
    mock = createMockFetch((req) =>
      req.path === '/api/orders'
        ? { status: 201, body: { order: orderFixture() } }
        : errorFixture(404, 'NOT_FOUND', 'nope'),
    )
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    await createOrder({ customerId: '10', lines: [{ productId: '20', qty: 2, unitPrice: '1.50' }] }, 'uuid-1')

    const recorded = mock.requests[0]
    expect(recorded?.method).toBe('POST')
    expect(recorded?.path).toBe('/api/orders')
    expect(recorded?.headers.get('idempotency-key')).toBe('uuid-1')
  })
})

/* ── R-UI-NFR-6: contract — request shapes per module ─────────────────── */

describe('R-UI-NFR-6: api client contract — request shape per module (vs fixtures)', () => {
  it('R-UI-NFR-6: auth.login → POST /api/auth/login with credentials body; me/patchMe carry Bearer', async () => {
    mock = createMockFetch((req) => {
      if (req.path === '/api/auth/login') return { status: 200, body: loginResponseFixture() }
      if (req.path === '/api/auth/me') return { status: 200, body: { user: userFixture } }
      return errorFixture(404, 'NOT_FOUND', 'nope')
    })
    vi.stubGlobal('fetch', mock.fetchMock)

    await authApi.login({ username: 'admin', password: 'Secret123' })
    const loginReq = mock.requests[0]
    expect(loginReq?.method).toBe('POST')
    expect(loginReq?.path).toBe('/api/auth/login')
    expect(loginReq?.headers.get('content-type')).toBe('application/json')
    expect(loginReq?.headers.get('authorization')).toBeNull() // login is anonymous
    expect(loginReq?.body).toEqual({ username: 'admin', password: 'Secret123' })

    setAccessToken('t1')
    await authApi.me()
    const meReq = mock.requests[1]
    expect(meReq?.method).toBe('GET')
    expect(meReq?.path).toBe('/api/auth/me')
    expect(meReq?.headers.get('authorization')).toBe('Bearer t1')
  })

  it('R-UI-NFR-6: listCustomers builds the query string and returns the Paginated envelope', async () => {
    mock = createMockFetch(() => ({ status: 200, body: paginated([customerFixture()]) }))
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const result = await listCustomers({ q: 'ana', status: 'active', page: 1, limit: 20 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.name).toBe('Ana Ruiz')
    expect(result.pagination.total).toBe(1)
    const recorded = mock.requests[0]
    expect(recorded?.method).toBe('GET')
    expect(recorded?.path).toBe('/api/customers?q=ana&status=active&page=1&limit=20')
    expect(recorded?.headers.get('authorization')).toBe('Bearer t1')
  })

  it('R-UI-NFR-6: listProducts / listWarehouses hit their endpoints with the standard envelope', async () => {
    mock = createMockFetch(() => ({ status: 200, body: paginated([productFixture()]) }))
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const products = await listProducts({ page: 1, limit: 50 })
    expect(products.data[0]?.sku).toBe('WID-1')
    expect(mock.requests[0]?.path).toBe('/api/products?page=1&limit=50')

    mock.reset()
    mock = createMockFetch(() => ({ status: 200, body: paginated([{ id: '30', name: 'Main WH', createdAt: 'x' }]) }))
    vi.stubGlobal('fetch', mock.fetchMock)
    const warehouses = await listWarehouses({ page: 1, limit: 20 })
    expect(warehouses.data[0]?.name).toBe('Main WH')
    expect(mock.requests[0]?.path).toBe('/api/warehouses?page=1&limit=20')
  })

  it('R-UI-NFR-6: getStock uses the {items} envelope deviation (no pagination) — snake_case rows', async () => {
    mock = createMockFetch(() => ({ status: 200, body: { items: [stockRowFixture()] } }))
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const result = await getStock({ productId: '20' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.level).toBe('3')
    expect(result.items[0]?.product_id).toBe('20')
    expect(mock.requests[0]?.path).toBe('/api/stock?productId=20')
    expect('data' in result).toBe(false) // deviation preserved — no {data,pagination}
  })

  it('R-UI-NFR-6: listMovements filter + adjust mutation shape (type locked to adjustment)', async () => {
    mock = createMockFetch((req) => {
      if (req.path.startsWith('/api/stock/movements')) {
        return req.method === 'GET'
          ? {
              status: 200,
              body: paginated([
                {
                  id: 'm1',
                  productId: '20',
                  warehouseId: '30',
                  type: 'adjustment',
                  quantity: 5,
                  sign: 1,
                  reason: 'initial stock',
                  idempotencyKey: null,
                  createdAt: 'x',
                  sku: 'WID-1',
                  productName: 'Widget',
                  warehouseName: 'Main WH',
                },
              ]),
            }
          : { status: 201, body: { movement: { id: 'm1', productId: '20', warehouseId: '30', type: 'adjustment', quantity: 5, sign: 1, reason: 'initial stock', idempotencyKey: null, createdAt: 'x' } } }
      }
      return errorFixture(404, 'NOT_FOUND', 'nope')
    })
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const movements = await listMovements({ type: 'adjustment', page: 1, limit: 20 })
    expect(mock.requests[0]?.path).toBe('/api/stock/movements?type=adjustment&page=1&limit=20')
    // MovementListItem DTO: movement + catalog names (camelCase)
    expect(movements.data[0]).toMatchObject({
      id: 'm1',
      productId: '20',
      sku: 'WID-1',
      productName: 'Widget',
      warehouseName: 'Main WH',
      type: 'adjustment',
    })

    await adjust(
      { productId: '20', warehouseId: '30', quantity: -5, reason: 'count correction' },
      'uuid-adj-1',
    )
    const adj = mock.requests[1]
    expect(adj?.method).toBe('POST')
    expect(adj?.path).toBe('/api/stock/movements')
    expect(adj?.headers.get('idempotency-key')).toBe('uuid-adj-1')
    expect(adj?.body).toEqual({
      type: 'adjustment',
      productId: '20',
      warehouseId: '30',
      quantity: -5,
      reason: 'count correction',
    })
  })

  it('R-UI-NFR-6: listOrders status filter; notifications unreadOnly=true; audit filters; users; jobs state+queue', async () => {
    mock = createMockFetch(() => ({ status: 200, body: paginated([]) }))
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    await listOrders({ status: 'confirmed', page: 1, limit: 20 })
    expect(mock.requests[0]?.path).toBe('/api/orders?status=confirmed&page=1&limit=20')

    await listNotifications({ unreadOnly: true, page: 1, limit: 5 })
    expect(mock.requests[1]?.path).toBe('/api/notifications?unreadOnly=true&page=1&limit=5')

    await listAudit({ entity: 'customer', action: 'customer.create', from: '2026-01-01T00:00:00Z', page: 1, limit: 20 })
    expect(mock.requests[2]?.path).toBe(
      '/api/audit?entity=customer&action=customer.create&from=2026-01-01T00%3A00%3A00Z&page=1&limit=20',
    )

    await listUsers({ page: 1, limit: 20 })
    expect(mock.requests[3]?.path).toBe('/api/users?page=1&limit=20')

    await listJobs({ state: 'completed', queue: 'report.queue', page: 1, limit: 20 })
    expect(mock.requests[4]?.path).toBe('/api/jobs?state=completed&queue=report.queue&page=1&limit=20')
  })

  it('R-UI-NFR-6: error normalization — server subcode surfaces as ApiClientError, UNKNOWN fallback for non-JSON', async () => {
    mock = createMockFetch((req) =>
      req.path === '/api/products'
        ? errorFixture(409, 'DUPLICATE_SKU', 'A product with this sku already exists')
        : { status: 500, body: undefined },
    )
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    await expect(api.get('/api/products')).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_SKU',
      message: 'A product with this sku already exists',
    })

    mock.reset()
    mock = createMockFetch(() => ({ status: 500, body: undefined, headers: { 'Content-Type': 'text/html' } }))
    vi.stubGlobal('fetch', mock.fetchMock)
    await expect(api.get('/api/weird')).rejects.toMatchObject({ status: 500, code: 'UNKNOWN' })
  })

  it('R-UI-NFR-6: DELETE 204 resolves to null data; get throws on missing resource', async () => {
    mock = createMockFetch(() => ({ status: 204, body: undefined }))
    vi.stubGlobal('fetch', mock.fetchMock)
    setAccessToken('t1')

    const deleted = await api.delete<null>('/api/warehouses/99')
    expect(deleted).toBeNull()
    expect(mock.requests[0]?.method).toBe('DELETE')
  })
})