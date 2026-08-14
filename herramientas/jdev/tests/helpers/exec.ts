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
}

const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url))

/** Spawn `node src/index.ts <args>` and capture stdout/stderr/status. */
export function runCli(args: string[], opts: RunCliOptions = {}): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.NO_COLOR
  delete env.FORCE_COLOR
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    input: opts.input ?? '',
    env,
    encoding: 'utf8',
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}
