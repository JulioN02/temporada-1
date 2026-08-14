import { Agent } from 'undici'
import { HttpError } from './errors.ts'

/** Default request timeout: 30 s (spec contract; asserted as a constant in tests). */
export const DEFAULT_TIMEOUT_MS = 30000

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  /** relax TLS verification ONLY (scoped per-request undici Agent, never global) */
  insecure?: boolean
}

/** Transport-faithful outcome: headers AS RECEIVED (masking is a renderer concern). */
export interface HttpOutcome {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
}

export type HttpResult = ({ ok: true } & HttpOutcome) | { ok: false; error: HttpError }

/**
 * Mini-curl request via global fetch.
 * - abort via AbortSignal.timeout (default 30 s; DOMException TimeoutError → 'TIMEOUT')
 * - `insecure` + https → lazily-created per-request undici Agent with
 *   rejectUnauthorized:false passed as `dispatcher` — TLS relaxation ONLY for
 *   that call; never a global dispatcher
 * - network/DNS/socket failures → 'NETWORK'; TLS failures → 'TLS'
 * - set-cookie expanded via getSetCookie() (iteration yields only the first)
 */
export async function request(url: string, opts: RequestOptions = {}): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    }
    if (opts.headers !== undefined) init.headers = opts.headers
    if (opts.body !== undefined) init.body = opts.body
    if (opts.insecure === true && url.startsWith('https:')) {
      // undici's Agent vs @types/node's bundled undici-types Dispatcher are
      // structurally incompatible (compose() signature) — runtime is undici
      // either way, so the cast is required and harmless.
      init.dispatcher = new Agent({ connect: { rejectUnauthorized: false } }) as unknown as NonNullable<RequestInit['dispatcher']>
    }
    const response = await fetch(url, init)
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: collectHeaders(response.headers),
      body: await response.text(),
    }
  } catch (err) {
    return { ok: false, error: classifyError(err, url, timeoutMs) }
  }
}

/**
 * Headers in insertion order, lowercase as undici delivers. undici's iteration
 * yields set-cookie ONLY with its first value — expand via getSetCookie() at
 * the first occurrence, skip later duplicates.
 */
function collectHeaders(headers: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let expanded = false
  for (const [name, value] of headers) {
    if (name === 'set-cookie') {
      if (expanded) continue
      expanded = true
      const cookies = headers.getSetCookie()
      for (const cookie of cookies.length > 0 ? cookies : [value]) {
        out.push([name, cookie])
      }
    } else {
      out.push([name, value])
    }
  }
  // Extremely defensive: if iteration hid set-cookie entirely, append it now.
  if (!expanded && headers.has('set-cookie')) {
    for (const cookie of headers.getSetCookie()) out.push(['set-cookie', cookie])
  }
  return out
}

/** TLS-related error codes seen from undici/node on certificate verification failure. */
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_SIGNATURE_FAILURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'U001',
])

function classifyError(err: unknown, url: string, timeoutMs: number): HttpError {
  // AbortSignal.timeout rejects with an AbortError whose cause is a DOMException TimeoutError.
  const name = (err as { name?: string } | undefined)?.name
  const cause = (err as { cause?: unknown } | undefined)?.cause
  const causeName = (cause as { name?: string } | undefined)?.name
  if (name === 'TimeoutError' || causeName === 'TimeoutError') {
    return new HttpError(`request timeout after ${timeoutMs} ms`, 'TIMEOUT')
  }
  // Walk the cause chain looking for TLS handshake/certificate codes.
  let cursor: unknown = err
  for (let depth = 0; depth < 4 && cursor !== undefined; depth++) {
    const c = cursor as { code?: unknown }
    const code = typeof c.code === 'string' ? c.code : ''
    if (TLS_CODES.has(code)) {
      return new HttpError(`TLS certificate verification failed: ${code}`, 'TLS')
    }
    cursor = (cursor as { cause?: unknown })?.cause
  }
  const reason = err instanceof Error ? err.message : String(err)
  return new HttpError(`network error requesting '${url}': ${reason}`, 'NETWORK')
}