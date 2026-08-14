import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export interface CliResult {
  stdout: string
  stderr: string
  status: number | null
}

export interface RunCliOptions {
  /** stdin payload (defaults to '' so the child stdin pipe closes immediately) */
  input?: string
  /** extra env vars; NO_COLOR and FORCE_COLOR are stripped unless explicitly given */
  env?: Record<string, string>
  /** spawnSync maxBuffer for stdout/stderr (default: Node's 1 MiB) */
  maxBuffer?: number
}

export interface CliRawOptions {
  /** stdin payload — Buffer keeps binary bytes intact */
  input?: string | Buffer
  /** extra env vars; NO_COLOR and FORCE_COLOR are stripped unless explicitly given */
  env?: Record<string, string>
}

export interface CliRawResult {
  stdout: Buffer
  stderr: Buffer
  status: number | null
}

const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url))

/** Build the child env: strip color overrides unless explicitly requested. */
function childEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.NO_COLOR
  delete env.FORCE_COLOR
  for (const [k, v] of Object.entries(extra ?? {})) env[k] = v
  return env
}

/** Spawn `node src/index.ts <args>` and capture stdout/stderr/status as utf8 strings. */
export function runCli(args: string[], opts: RunCliOptions = {}): CliResult {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    input: opts.input ?? '',
    env: childEnv(opts.env),
    encoding: 'utf8',
    ...(opts.maxBuffer === undefined ? {} : { maxBuffer: opts.maxBuffer }),
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

/** Same as runCli but captures raw Buffers — required for binary-safe assertions. */
export function runCliRaw(args: string[], opts: CliRawOptions = {}): CliRawResult {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    input: opts.input ?? '',
    env: childEnv(opts.env),
  })
  return {
    stdout: result.stdout as Buffer,
    stderr: result.stderr as Buffer,
    status: result.status,
  }
}