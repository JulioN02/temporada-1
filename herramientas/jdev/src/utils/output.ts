const ANSI_RED = '\x1b[31m'
const ANSI_RESET = '\x1b[0m'

/**
 * Color policy: NO_COLOR non-empty wins (conservative); otherwise FORCE_COLOR
 * non-empty forces color; otherwise fall back to stdout.isTTY.
 */
export function shouldColor(): boolean {
  const noColor = process.env.NO_COLOR
  if (noColor !== undefined && noColor !== '') return false
  const forceColor = process.env.FORCE_COLOR
  if (forceColor !== undefined && forceColor !== '') return true
  return process.stdout.isTTY === true
}

/** Diagnostics → stderr only (red when the color policy allows). */
export function stderr(msg: string): void {
  process.stderr.write(shouldColor() ? `${ANSI_RED}${msg}${ANSI_RESET}\n` : `${msg}\n`)
}

/** Data → stdout only, never colorized (pipe discipline invariant). */
export function stdoutData(data: string): void {
  process.stdout.write(data)
}
