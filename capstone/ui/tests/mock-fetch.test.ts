/**
 * T-2-3 (capstone-ui it2a) — mock fetch harness contract (R-UI-NFR-6).
 * RED: asserts the harness records the exact request shape and serves
 * scripted responses — references `createMockFetch` which does not exist yet.
 * Mock fetch is the single seam: unit tests NEVER hit a live backend.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockFetch } from './helpers/mockFetch.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('R-UI-NFR-6: mock fetch harness records request shape (T-2-3)', () => {
  it('R-UI-NFR-6: records method, path (with query), headers and parsed body of each call', async () => {
    const handle = createMockFetch(() => ({ status: 200, body: { ok: true } }))
    vi.stubGlobal('fetch', handle.fetchMock)

    const res = await fetch('/api/customers?page=2&limit=10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t1' },
      body: JSON.stringify({ name: 'Ana Ruiz' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(handle.requests).toHaveLength(1)
    const recorded = handle.requests[0]
    expect(recorded).toBeDefined()
    expect(recorded!.method).toBe('POST')
    expect(recorded!.path).toBe('/api/customers?page=2&limit=10')
    expect(recorded!.headers.get('authorization')).toBe('Bearer t1')
    expect(recorded!.headers.get('content-type')).toBe('application/json')
    expect(recorded!.body).toEqual({ name: 'Ana Ruiz' })
  })

  it('R-UI-NFR-6: serves scripted error responses and 204 with no body', async () => {
    const handle = createMockFetch((req) =>
      req.path === '/api/stock'
        ? { status: 204, body: undefined }
        : { status: 409, body: { error: { code: 'INSUFFICIENT_STOCK', message: 'nope' } } },
    )
    vi.stubGlobal('fetch', handle.fetchMock)

    const conflict = await fetch('/api/orders/1/confirm', { method: 'POST' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: { code: 'INSUFFICIENT_STOCK', message: 'nope' } })

    const empty = await fetch('/api/stock')
    expect(empty.status).toBe(204)
    expect(await empty.text()).toBe('')
  })

  it('R-UI-NFR-6: fetch calls can be asserted with vitest matchers (single seam)', async () => {
    const handle = createMockFetch(() => ({ status: 200, body: [] }))
    vi.stubGlobal('fetch', handle.fetchMock)

    await fetch('/api/products')
    await fetch('/api/products')

    expect(handle.fetchMock).toHaveBeenCalledTimes(2)
    expect(handle.requests.map((r) => r.path)).toEqual(['/api/products', '/api/products'])
  })
})