import type { Command } from 'commander'
import { JdevError, UsageError } from '../core/errors.ts'
import { stderr } from '../utils/output.ts'

/** Codes commander emits AFTER it already wrote the output (help/version) itself. */
const SUCCESS_CODES = new Set(['commander.helpDisplayed', 'commander.version'])

/**
 * Exit-code contract via exitOverride (commander v15 writes the message to
 * stderr itself before calling _exit, so we only map the exit code):
 * - commander.* errors (unknown command/option, missing argument) → 1
 * - help/version display → 0 (honors commander's own exitCode for `help`)
 * - anything else → 2
 * Uses process.exitCode (NOT process.exit) so stdout flushes — pipe discipline preserved.
 */
export function installExitOverride(program: Command): void {
  // Route commander's own stderr output (errors, help-on-error) through our color policy.
  program.configureOutput({
    writeErr: (str: string) => stderr(str.endsWith('\n') ? str.slice(0, -1) : str),
  })

  program.exitOverride((err: Error) => {
    const e = err as { code?: string; exitCode?: number }
    const code = e.code ?? ''
    if (SUCCESS_CODES.has(code)) {
      process.exitCode = 0
      return
    }
    if (code === 'commander.help') {
      // Built-in `help` subcommand path: commander already wrote the help; honor its exit code.
      process.exitCode = e.exitCode ?? 0
      return
    }
    if (code.startsWith('commander.')) {
      // Commander already wrote the message to stderr via outputError — usage error → 1.
      process.exitCode = 1
      return
    }
    stderr(err.message)
    process.exitCode = 2
  })
}

/** Map an action error to the process exit code (single source of truth). */
export function mapErrorToExit(err: unknown): void {
  if (err instanceof UsageError) {
    stderr(err.message)
    process.exitCode = 1
    return
  }
  if (err instanceof JdevError) {
    stderr(err.message)
    process.exitCode = 2
    return
  }
  stderr(`internal error: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 2
}

/** Wrap a commander action so thrown errors flow through mapErrorToExit. */
export function guard<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => Promise<void> {
  return (...args: A): Promise<void> =>
    Promise.resolve()
      .then(() => fn(...args)) // runs inside the chain: sync throws AND async rejections both land in .catch
      .then(() => undefined)
      .catch(mapErrorToExit)
}

/** EPIPE (downstream pipe closed early, e.g. `jdev uuid | head -1`) → exit 0 silently. */
export function installEpipeGuard(): void {
  const onError = (err: NodeJS.ErrnoException): void => {
    if (err.code === 'EPIPE') process.exit(0)
  }
  process.stdout.on('error', onError)
  process.stderr.on('error', onError)
}