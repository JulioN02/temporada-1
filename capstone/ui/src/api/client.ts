import type { PublicUser } from './types.ts'

/**
 * Fetch wrapper + session machinery (capstone-ui it2a, T-2-5 — design
 * ADR-3/ADR-5, port-adapted from inventory-stock frontend).
 *
 * - Access token lives in MEMORY only (module-scoped variable) — never
 *   localStorage/sessionStorage/cookies (R-AUTHUI-2).
 * - 401 → single-flight refresh (`POST /api/auth/refresh`, httpOnly cookie):
 *   concurrent 401s coalesce onto ONE in-flight refresh (R-AUTHUI-1); after a
 *   successful refresh the original request retries EXACTLY once.
 * - Bounded by construction: a request already retried never refreshes again;
 *   login/refresh requests never trigger the refresh path; refresh failure →
 *   token cleared + onSessionExpired (it2b AuthContext routes to /login).
 * - `apiFetchRaw` exposes the raw HTTP status so callers distinguish 201
 *   (created) from 200 (idempotent replay) — the only replay signal
 *   (R-UI-FND-4).
 * - Errors normalize to `ApiClientError {status, code, message}` — `message`
 *   is the server code string (e.g. "INSUFFICIENT_STOCK"), NEVER rendered
 *   raw; localizeError maps it for display (R-I18N-4).
 */
export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string }
}

/** Refresh response carries the user + a fresh access token (R-AUTH-4). */
export interface RefreshResult {
  user: PublicUser
  accessToken: string
}

let accessToken: string | null = null
let onSessionExpired: (() => void) | null = null

/** Single-flight seam: concurrent 401s share ONE in-flight refresh. */
let refreshPromise: Promise<RefreshResult | null> | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

/** it2b AuthContext wires the session-expired handler (routes to /login). */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

/**
 * Raw refresh (cookie-only, no Authorization header): the ONLY place that
 * touches `/api/auth/refresh`. Exported as the boot-restore seam (it2b
 * AuthProvider calls it once on mount — single round trip, R-AUTHUI-4).
 * Never goes through the 401 path — bounded by construction.
 */
export async function refreshAccessToken(): Promise<RefreshResult | null> {
  let res: Response
  try {
    res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const data = (await res.json()) as RefreshResult
  accessToken = data.accessToken
  return data
}

/** Single-flight access: first caller starts the refresh, the rest await it. */
async function getRefreshedToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken()
  }
  try {
    const result = await refreshPromise
    return result?.accessToken ?? null
  } finally {
    refreshPromise = null
  }
}

export interface RequestOptions extends RequestInit {
  /** Internal guard: a request already retried never refreshes again. */
  retried?: boolean
}

/**
 * Shared request flow: Bearer + Content-Type headers, 401 → single-flight
 * refresh → retry ONCE, uniform ApiClientError envelope. Returns the raw
 * HTTP status plus the parsed body (201-vs-200 replay signal, R-UI-FND-4).
 */
async function apiFetchRaw<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ status: number; data: T }> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  const isLogin = path === '/api/auth/login' || path.startsWith('/api/auth/login')
  const isRefresh = path === '/api/auth/refresh'

  const res = await fetch(path, { ...options, headers })

  if (res.status === 401 && !options.retried && !isLogin && !isRefresh) {
    const token = await getRefreshedToken()
    if (token) {
      return apiFetchRaw<T>(path, { ...options, retried: true })
    }
    setAccessToken(null)
    onSessionExpired?.()
    throw new ApiClientError(401, 'UNAUTHORIZED', 'Session expired')
  }

  if (!res.ok) {
    let body: ErrorBody | null = null
    try {
      body = (await res.json()) as ErrorBody
    } catch {
      body = null
    }
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `Request failed with status ${res.status}`,
    )
  }
  return { status: res.status, data: res.status === 204 ? (null as T) : ((await res.json()) as T) }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const result = await apiFetchRaw<T>(path, options)
  return result.data
}

/** Build a query string from params, dropping undefined/null/empty values. */
export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value !== '') {
      search.set(key, value)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  return query === '' ? '' : `?${query}`
}

export const api = {
  get: <T>(path: string): Promise<T> => apiFetch<T>(path),
  post: <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> => {
    const options: RequestOptions = { method: 'POST', body: JSON.stringify(body) }
    if (headers) options.headers = headers
    return apiFetch<T>(path, options)
  },
  patch: <T>(path: string, body: unknown): Promise<T> =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => apiFetch<T>(path, { method: 'DELETE' }),
  /** POST exposing the raw status — used ONLY by idempotent mutation writes (replay 200 vs 201). */
  postWithStatus: <T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; data: T }> => {
    const options: RequestOptions = { method: 'POST', body: JSON.stringify(body) }
    if (headers) options.headers = headers
    return apiFetchRaw<T>(path, options)
  },
}