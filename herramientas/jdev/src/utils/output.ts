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
export function stdoutData(data: string | Buffer): void {
  writeStdout(data, process.stdout.isTTY === true)
}

/**
 * Write payload to stdout.
 *
 * Visual-pipe ergonomics: when stdout IS a TTY (a human is watching), ensure
 * the payload ends with a newline so the next shell prompt starts on a fresh
 * line — applies to binary-safe commands (base64 decode, csv tojson, http
 * body) whose data is emitted verbatim. When stdout is NOT a TTY (pipe/file),
 * bytes are written EXACTLY as given: binary purity is preserved for programs
 * consuming the output (e.g. `jdev base64 decode file > img.png`).
 */
export function writeStdout(data: string | Buffer, isTty: boolean): void {
  if (isTty && !hasTrailingNewline(data)) {
    if (typeof data === 'string') {
      process.stdout.write(`${data}\n`)
    } else {
      process.stdout.write(Buffer.concat([data, Buffer.from([0x0a])]))
    }
    return
  }
  process.stdout.write(data)
}

/** True when the payload already ends in a newline (string or raw byte). */
function hasTrailingNewline(data: string | Buffer): boolean {
  if (typeof data === 'string') return data.endsWith('\n')
  return data.length > 0 && data[data.length - 1]! === 0x0a
}
