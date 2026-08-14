import type { Command } from 'commander'
import { request, type HttpOutcome } from '../core/http.ts'
import { UsageError } from '../core/errors.ts'
import { shouldColor, stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

/** Header names whose values are ALWAYS masked in output (security invariant). */
const MASKED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie'])

/**
 * PURE output renderer (unit-testable, no IO):
 * exact layout `HTTP/1.1 <status> <statusText>` + header lines (lowercase,
 * insertion order, set-cookie expanded) + blank line + raw body (no added
 * newline). Masking of authorization|cookie|set-cookie is ALWAYS applied here
 * — including --insecure calls — because output security lives in the renderer.
 * The status line is the ONLY colorized stdout surface (class-colored).
 */
export function renderHttp(outcome: HttpOutcome, color: boolean): string {
  const statusLine = `HTTP/1.1 ${outcome.status} ${outcome.statusText}`.trimEnd()
  const statusColor = color ? colorizeStatus(statusLine, outcome.status) : statusLine
  const headerBlock = outcome.headers.map(([name, value]) => `${name}: ${mask(name, value)}\n`).join('')
  // status line + \n, header lines each + \n, ONE blank line, raw body (no added newline)
  return `${statusColor}\n${headerBlock}\n${outcome.body}`
}

function mask(name: string, value: string): string {
  return MASKED_HEADERS.has(name.toLowerCase()) ? '***' : value
}

const ANSI = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
} as const

function colorizeStatus(line: string, status: number): string {
  if (status >= 500) return `${ANSI.red}${line}${ANSI.reset}`
  if (status >= 400) return `${ANSI.yellow}${line}${ANSI.reset}`
  if (status >= 200 && status < 300) return `${ANSI.green}${line}${ANSI.reset}`
  return line
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
    throw new UsageError(`invalid --timeout '${raw}' (expected integer seconds between 1 and 600)`, 'INVALID_TIMEOUT')
  }
  return seconds * 1000
}

function parseHeaderFlag(raw: string): [string, string] {
  const colon = raw.indexOf(':')
  if (colon === -1) {
    throw new UsageError(`invalid header '${raw}' (expected 'Name: value')`, 'INVALID_HEADER')
  }
  return [raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()]
}

/** Register the `http` subcommand: mini-curl with masked secrets + --insecure. */
export function register(program: Command): void {
  program
    .command('http')
    .description('issue an HTTP request (mini-curl; secrets always masked)')
    .argument('<url>', 'target URL')
    .option('-X, --method <method>', 'HTTP method (default GET, or POST when -d is given)')
    .option('-H, --header <name:value>', 'request header (repeatable)', collect, [])
    .option('-d, --data <data>', 'request body (implies POST without -X)')
    .option('--timeout <seconds>', 'abort timeout in seconds (default 30)')
    .option('--insecure', 'skip TLS certificate verification (request-scoped only)')
    .action(guard(async (url: string, opts: { method?: string; header?: string[]; data?: string; timeout?: string; insecure?: boolean }) => {
      const method = (opts.method ?? (opts.data !== undefined ? 'POST' : 'GET')).toUpperCase()
      const headers: Record<string, string> = {}
      for (const raw of opts.header ?? []) {
        const [name, value] = parseHeaderFlag(raw)
        headers[name] = value
      }
      if ((method === 'GET' || method === 'HEAD') && opts.data !== undefined) {
        throw new UsageError(`--data cannot be used with ${method} requests (fetch forbids a body)`, 'BODY_WITH_METHOD')
      }
      const timeoutMs = opts.timeout === undefined ? undefined : parseTimeout(opts.timeout)
      const result = await request(url, {
        method,
        headers,
        ...(opts.data === undefined ? {} : { body: opts.data }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        insecure: opts.insecure === true,
      })
      if (!result.ok) throw result.error
      stdoutData(renderHttp(result, shouldColor()))
    }))
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}