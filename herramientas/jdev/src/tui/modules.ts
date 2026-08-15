import { confirm, input, number, password } from '@inquirer/prompts'
import { menuSelect } from './menu.ts'
import { readFile, stat } from 'node:fs/promises'
import { encodeBase64, decodeBase64 } from '../core/base64.ts'
import { csvInfo, csvToJson, formatCsv } from '../core/csv.ts'
import { formatJson, minifyJson, validateJson } from '../core/json.ts'
import { hashPassword, verifyPassword, generatePassword } from '../core/password.ts'
import { epochMillis, epochSeconds, parseEpoch, toIsoLocal, toIsoUtc } from '../core/timestamp.ts'
import { hashStream } from '../core/hash.ts'
import { decodeJwt } from '../core/jwt.ts'
import { uuidV4, uuidV7 } from '../core/uuid.ts'
import { request } from '../core/http.ts'
import { renderHttp } from '../cli/http.ts'
import { t } from '../i18n.ts'

export const CYAN = '\x1b[36m'
export const GREEN = '\x1b[32m'
export const YELLOW = '\x1b[33m'
export const RED = '\x1b[31m'
export const DIM = '\x1b[2m'
export const BOLD = '\x1b[1m'
export const RESET = '\x1b[0m'

/** Sentinel value used by every TUI menu for "return to main menu". */
export const BACK = 'back' as const

/** Limit for on-screen results; longer outputs are truncated with a note. */
const MAX_LINES = 24

/** Header separator length for the result block. */
function rule(title: string): string {
  return `${CYAN}── ${title} ${'─'.repeat(Math.max(2, 44 - title.length))}${RESET}`
}

/**
 * Print the equivalent plain CLI command, then the titled result block.
 * `cmd` is the copy-pasteable `jdev …` line that produced this output;
 * `note` (e.g. secret-masking disclaimer) is emitted dim below the block.
 */
export function showResult(cmd: string | null, title: string, body: string, note?: string): void {
  if (cmd !== null) process.stdout.write(`${DIM}$ ${cmd}${RESET}\n`)
  process.stdout.write(`${rule(title)}\n`)
  const lines = body.split('\n')
  const shown = lines.slice(0, MAX_LINES)
  process.stdout.write(shown.join('\n'))
  if (lines.length > MAX_LINES) {
    process.stdout.write(`\n${DIM}${t('moreLines', { n: lines.length - MAX_LINES })}${RESET}`)
  }
  process.stdout.write('\n')
  if (note !== undefined) process.stdout.write(`${DIM}${note}${RESET}\n`)
  process.stdout.write('\n')
}

/** Pause after a completed module: any Enter returns to the main menu. */
export async function backToMenu(): Promise<void> {
  await input({ message: t('backPrompt'), default: '' })
}

/** Shell-safe single-quoted string (embedded quotes escaped POSIX-style). */
function q(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`
}

/** Pipe text into a stdin-reading jdev subcommand. */
function pipe(text: string, cmdSuffix: string): string {
  return `printf '%s' ${q(text)} | jdev ${cmdSuffix}`
}

/** Path picker shared by file-based modules. undefined = cancelled (no prompt after). */
async function askPath(what: string): Promise<string | undefined> {
  const path = await input({
    message: t('askPath', { what }),
    validate: (v) => (v.trim() === '' ? true : true),
  })
  if (path.trim() === '') return undefined
  try {
    const s = await stat(path.trim())
    if (!s.isFile()) throw new Error(t('notAFile'))
  } catch {
    process.stdout.write(`${RED}✗ ${t('cannotRead', { path: path.trim() })}${RESET}\n\n`)
    return undefined
  }
  return path.trim()
}

export async function uuidMenu(): Promise<boolean> {
  const version = await menuSelect({
    message: t('uuidVersion'),
    choices: [
      { name: t('uuidV4'), value: 'v4' },
      { name: t('uuidV7'), value: 'v7' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (version === BACK) return true
  const count = await number({
    message: t('uuidCount'),
    default: 1,
    validate: (v) => (v === undefined || v < 1 || v > 1000 ? t('range1000') : true),
  })
  const n = count ?? 1
  const gen = version === 'v7' ? uuidV7 : uuidV4
  const lines: string[] = []
  for (let i = 0; i < n; i++) lines.push(gen())
  showResult(`jdev uuid --${version} --count ${n}`, `UUID ${version} × ${n}`, lines.join('\n'))
  return false
}

export async function jsonMenu(): Promise<boolean> {
  const action = await menuSelect({
    message: t('jsonAction'),
    choices: [
      { name: t('jsonFormat'), value: 'format' },
      { name: t('jsonMinify'), value: 'minify' },
      { name: t('jsonValidate'), value: 'validate' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (action === BACK) return true
  const path = await askPath(t('jsonPath'))
  if (path === undefined) return true
  const cmd = `jdev json ${action} ${q(path)}`
  try {
    const text = await readFile(path, 'utf8')
    if (action === 'validate') {
      const r = validateJson(text)
      if (r.ok) {
        process.stdout.write(`${DIM}$ ${cmd}${RESET}\n${GREEN}✓ ${t('validJson')}${RESET}\n\n`)
      } else {
        process.stdout.write(`${DIM}$ ${cmd}${RESET}\n${RED}✗ ${t('invalidJsonAt', { line: r.line, column: r.column })}${RESET}\n\n`)
      }
      return false
    }
    showResult(cmd, `JSON ${action}`, action === 'format' ? formatJson(text) : minifyJson(text))
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

export async function base64Menu(): Promise<boolean> {
  const action = await menuSelect({
    message: t('b64Action'),
    choices: [
      { name: t('b64Encode'), value: 'encode' },
      { name: t('b64Decode'), value: 'decode' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (action === BACK) return true
  const url = await menuSelect({
    message: t('b64Variant'),
    choices: [
      { name: t('b64Std'), value: 'std' },
      { name: t('b64Url'), value: 'url' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (url === BACK) return true
  const urlMode = url === 'url'
  const raw = await input({ message: action === 'encode' ? t('b64TextIn') : t('b64StrIn') })
  try {
    if (action === 'encode') {
      const out = encodeBase64(Buffer.from(raw, 'utf8'), { url: urlMode, padding: !urlMode })
      showResult(pipe(raw, `base64 encode${urlMode ? ' --url' : ''}`), 'Base64 encode', out)
    } else {
      const out = decodeBase64(raw, { url: urlMode }).toString('utf8')
      const printable = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(out)
      const cmd = pipe(raw, `base64 decode${url ? ' --url' : ''}`)
      showResult(cmd, 'Base64 decode', printable ? JSON.stringify(out) : out)
    }
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

export async function timestampMenu(): Promise<boolean> {
  const mode = await menuSelect({
    message: t('tsMode'),
    choices: [
      { name: t('tsNow'), value: 'now' },
      { name: t('tsConvert'), value: 'convert' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (mode === BACK) return true
  const unit = await menuSelect({
    message: t('tsUnit'),
    choices: [
      { name: t('tsSeconds'), value: 'sec' },
      { name: t('tsMillis'), value: 'ms' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (unit === BACK) return true
  const ms = unit === 'ms'
  const iso = await menuSelect({
    message: t('tsOut'),
    choices: [
      { name: t('tsDigits'), value: 'digits' },
      { name: t('tsUtc'), value: 'utc' },
      { name: t('tsLocal'), value: 'local' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (iso === BACK) return true
  try {
    let output: string
    let cmd: string
    const unit = ms ? '--ms ' : ''
    const outFlag = iso === 'digits' ? '' : iso === 'utc' ? '--iso' : '--iso --local'
    if (mode === 'now') {
      const seconds = ms ? epochMillis() : epochSeconds()
      output = iso === 'digits' ? String(seconds) : iso === 'utc' ? toIsoUtc(ms ? seconds : seconds * 1000) : toIsoLocal(ms ? seconds : seconds * 1000)
      cmd = `jdev timestamp ${unit}${outFlag}`.trimEnd()
    } else {
      const raw = await input({ message: t('tsInput') })
      const seconds = parseEpoch(raw)
      output = iso === 'digits' ? String(seconds) : iso === 'utc' ? toIsoUtc(ms ? seconds : seconds * 1000) : toIsoLocal(ms ? seconds : seconds * 1000)
      cmd = `jdev timestamp ${q(raw)} ${unit}${outFlag}`.trimEnd()
    }
    showResult(cmd, 'Timestamp', output)
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

export async function hashMenu(): Promise<boolean> {
  const path = await askPath(t('hashPath'))
  if (path === undefined) return true
  const algorithm = await menuSelect({
    message: t('hashAlgo'),
    choices: [
      { name: 'SHA-256', value: 'sha256' },
      { name: 'SHA-512', value: 'sha512' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (algorithm === BACK) return true
  try {
    const { createReadStream } = await import('node:fs')
    const digest = await hashStream(createReadStream(path), algorithm)
    showResult(`jdev hash --file ${q(path)} --algorithm ${algorithm}`, `Hash ${algorithm}`, digest)
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

export async function passwordMenu(): Promise<boolean> {
  const action = await menuSelect({
    message: t('pwAction'),
    choices: [
      { name: t('pwGen'), value: 'generate' },
      { name: t('pwHash'), value: 'hash' },
      { name: t('pwVerify'), value: 'verify' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (action === BACK) return true
  try {
    if (action === 'generate') {
      const len = await number({ message: t('pwLen'), default: 16, validate: (v) => (v === undefined || v < 1 || v > 1024 ? t('range1024') : true) })
      showResult(`jdev password generate --length ${len ?? 16}`, `Password generada (${len ?? 16})`, generatePassword(len ?? 16))
      return false
    }
    if (action === 'hash') {
      const pw = await password({ message: t('pwPrompt'), mask: '•' })
      if (pw === '') throw new Error(t('pwEmpty'))
      const cost = await number({ message: t('pwCost'), default: 10, validate: (v) => (v === undefined || v < 4 || v > 31 ? t('range431') : true) })
      showResult(`jdev password hash --cost ${cost ?? 10}`, `bcrypt hash (cost ${cost ?? 10})`, hashPassword(pw, cost ?? 10), t('secretNote'))
      return false
    }
    const pw = await password({ message: t('pwVerifyPrompt'), mask: '•' })
    const hash = await input({ message: t('hashInput') })
    const r = verifyPassword(pw, hash)
    const cmd = 'jdev password verify'
    if (r.ok) {
      process.stdout.write(`${DIM}$ ${cmd}${RESET}\n${GREEN}✓ ${t('pwMatch')}${RESET}\n${DIM}${t('secretNote')}${RESET}\n\n`)
    } else if (r.malformed) {
      process.stdout.write(`${RED}✗ ${t('pwMalformed')}${RESET}\n\n`)
    } else {
      process.stdout.write(`${RED}✗ ${t('pwMismatch')}${RESET}\n\n`)
    }
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

export async function jwtMenu(): Promise<boolean> {
  const token = await input({ message: t('jwtToken') })
  try {
    const { header, payload } = decodeJwt(token)
    showResult('jdev jwt decode', t('jwtHeader'), JSON.stringify(header, null, 2), t('secretNote'))
    showResult(null, t('jwtPayload'), JSON.stringify(payload, null, 2))
    process.stdout.write(`${DIM}${t('jwtSigNote')}${RESET}\n\n`)
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

export async function csvMenu(): Promise<boolean> {
  const action = await menuSelect({
    message: t('csvAction'),
    choices: [
      { name: t('csvInfo'), value: 'info' },
      { name: t('csvFormat'), value: 'format' },
      { name: t('csvToJson'), value: 'tojson' },
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (action === BACK) return true
  const path = await askPath(t('csvPath'))
  if (path === undefined) return true
  try {
    const { createReadStream } = await import('node:fs')
    const source = createReadStream(path)
    const cmd = `jdev csv ${action} ${q(path)}`
    if (action === 'info') {
      const { rows, columns } = await csvInfo(source)
      showResult(cmd, 'CSV info', `rows: ${rows}\ncolumns: ${columns}`)
      return false
    }
    if (action === 'format') {
      let out = ''
      for await (const line of formatCsv(source)) out += line
      showResult(cmd, 'CSV format', out.trimEnd())
      return false
    }
    let out = ''
    for await (const chunk of csvToJson(source)) out += chunk
    showResult(cmd, 'CSV → JSON', out)
  } catch (err) {
    process.stdout.write(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${RESET}\n\n`)
  }
  return false
}

/** Header names whose values are secrets: masked in the echoed command. */
function isSecretHeader(name: string): boolean {
  return /authorization|cookie|token|secret|api[_-]?key|password/i.test(name)
}

export async function httpMenu(): Promise<boolean> {
  const url = await input({ message: t('httpUrl') })
  if (!/^https?:\/\//.test(url.trim())) {
    process.stdout.write(`${RED}✗ ${t('httpUrlBad')}${RESET}\n\n`)
    return false
  }
  const method = await menuSelect({
    message: t('httpMethod'),
    choices: [
      ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => ({
        name: m === 'GET' ? 'GET (default)' : m,
        value: m,
      })),
      { name: t('backToMain'), value: BACK },
    ],
  })
  if (method === BACK) return true
  const body = await input({ message: t('httpBody'), default: '' })
  const headers: Record<string, string> = {}
  for (let i = 0; i < 5; i++) {
    const h = await input({ message: t('httpHeader', { i: i + 1 }), default: '' })
    if (h.trim() === '') break
    const colon = h.indexOf(':')
    if (colon === -1) {
      process.stdout.write(`${YELLOW}⚠ ${t('httpHeaderBad', { h })}${RESET}\n`)
      continue
    }
    headers[h.slice(0, colon).trim()] = h.slice(colon + 1).trim()
  }
  const timeout = await number({ message: t('httpTimeout'), default: 30, validate: (v) => (v === undefined || v < 1 || v > 600 ? t('range600') : true) })
  const insecure = await confirm({ message: t('httpTls'), default: false })
  process.stdout.write(`${DIM}${t('sending')}${RESET}\n`)
  const result = await request(url.trim(), {
    method,
    ...(body === '' ? {} : { body }),
    headers,
    timeoutMs: (timeout ?? 30) * 1000,
    insecure,
  })
  if (!result.ok) {
    process.stdout.write(`${RED}✗ ${result.error.message}${RESET}\n\n`)
    return false
  }
  const parts = [`jdev http ${q(url.trim())}`, `-X ${method}`]
  for (const [name, value] of Object.entries(headers)) {
    parts.push(`-H ${q(`${name}: ${isSecretHeader(name) ? t('masked') : value}`)}`)
  }
  if (body !== '') parts.push(`-d ${q(body)}`)
  parts.push(`--timeout ${timeout ?? 30}`)
  if (insecure) parts.push('--insecure')
  showResult(parts.join(' '), `HTTP ${method} — ${result.status} ${result.statusText}`, renderHttp(result, true).replace(`HTTP/1.1 ${result.status} ${result.statusText}`, `${GREEN}HTTP/1.1 ${result.status} ${result.statusText}${RESET}`))
  return false
}