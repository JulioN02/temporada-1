import { vi } from 'vitest'

/**
 * Mock fetch harness (capstone-ui it2a, T-2-3) — the SINGLE test seam.
 * Unit/component tests stub the global fetch with `createMockFetch` and
 * NEVER hit a live backend (R-UI-NFR-6). Every call is recorded as
 * {method, path, headers, body} so contract tests can assert the exact
 * request shape the api client sends; the responder script returns
 * status + JSON body (204 → empty body, mirroring the backend contract).
 */
export interface RecordedRequest {
  method: string
  /** pathname + search, e.g. `/api/customers?page=2&limit=10` */
  path: string
  headers: Headers
  /** parsed JSON body, or undefined when the request carried no body */
  body: unknown
}

export interface ScriptedResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type Responder = (request: RecordedRequest) => ScriptedResponse | Promise<ScriptedResponse>

export interface MockFetchHandle {
  /** The vi.fn to `vi.stubGlobal('fetch', handle.fetchMock)`. */
  fetchMock: ReturnType<typeof vi.fn>
  /** Every recorded request, in call order. */
  requests: RecordedRequest[]
  reset: () => void
}

function parseBody(raw: BodyInit | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** Normalize a fetch input to a full URL string (string | URL | Request). */
function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

export function createMockFetch(responder: Responder): MockFetchHandle {
  const requests: RecordedRequest[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(toUrl(input), 'http://localhost')
    const path = `${url.pathname}${url.search}`
    const headers = new Headers(init?.headers)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = parseBody(init?.body)
    const record: RecordedRequest = { method, path, headers, body }
    requests.push(record)

    const scripted = await responder(record)
    const responseHeaders = new Headers(scripted.headers)
    if (!responseHeaders.has('Content-Type') && scripted.body !== undefined) {
      responseHeaders.set('Content-Type', 'application/json')
    }
    const responseBody = scripted.status === 204 || scripted.body === undefined ? null : JSON.stringify(scripted.body)
    return new Response(responseBody, { status: scripted.status, headers: responseHeaders })
  })

  return {
    fetchMock,
    requests,
    reset: () => {
      requests.length = 0
    },
  }
}