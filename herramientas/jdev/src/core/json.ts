import { JsonParseError, type JsonErrorPosition } from './errors.ts'

export interface JsonOk {
  ok: true
}

export interface JsonFailure {
  ok: false
  line: number
  column: number
  position: number
}

export type JsonValidation = JsonOk | JsonFailure

// V8 JSON.parse message shapes (Node 22+):
//   1. "Expected ... in JSON at position 7 (line 1 column 8)"  — native line/column
//   2. "Expected ... in JSON at position 7"                    — position only (older V8)
//   3. "Unexpected end of JSON input"                          — unterminated, no position
//   4. "Unexpected token 'x', \"...\" is not valid JSON"       — token errors, no position
const NATIVE_LC_RE = /\(line (\d+) column (\d+)\)/
const POSITION_RE = /at position (\d+)/
const EOF_RE = /Unexpected end of JSON input/
const TOKEN_RE = /Unexpected token '([^']*)'/

/** 0-based `position` → 1-based {line, column} by scanning the text up to it. */
function locate(text: string, position: number): { line: number; column: number } {
  const upTo = text.slice(0, position)
  return {
    line: upTo.split('\n').length,
    column: position - upTo.lastIndexOf('\n'),
  }
}

/**
 * Extract {position, line, column} from the native SyntaxError message.
 * Never swallows the parse information (spec: parse position must not be swallowed).
 */
function analyzeJsonError(text: string, err: Error): JsonFailure {
  const message = err.message
  let position: number | undefined

  const posMatch = POSITION_RE.exec(message)
  if (posMatch !== null) {
    position = Number(posMatch[1])
  } else if (EOF_RE.test(message)) {
    // Unterminated input: the failure is at the end of the text.
    position = text.length
  } else {
    // Token errors without native position: locate the offending token in the text.
    const token = TOKEN_RE.exec(message)?.[1]
    if (token !== undefined && token !== '') {
      const idx = text.indexOf(token)
      if (idx >= 0) position = idx
    }
  }
  if (position === undefined) position = text.length // last resort; message still names the detail

  const { line, column } = locate(text, position)
  return { ok: false, line, column, position }
}

/** Parse JSON text, throwing JsonParseError (exit 2) with position info on failure. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    const failure = analyzeJsonError(text, err instanceof Error ? err : new Error(String(err)))
    throw jsonFailureToError(failure)
  }
}

/** Pretty-print JSON text with a 2-space indent (validates first). */
export function formatJson(text: string): string {
  return JSON.stringify(parseJson(text), null, 2)
}

/** Emit compact single-line JSON (validates first). */
export function minifyJson(text: string): string {
  return JSON.stringify(parseJson(text))
}

/**
 * Validate JSON text without throwing: `{ok:true}` or a failure carrying
 * position/line/column for the CLI to report (validate is silent on success).
 */
export function validateJson(text: string): JsonValidation {
  try {
    JSON.parse(text)
    return { ok: true }
  } catch (err) {
    return analyzeJsonError(text, err instanceof Error ? err : new Error(String(err)))
  }
}

/** Convenience: turn a JsonFailure into the throwable error (used by the CLI). */
export function jsonFailureToError(failure: JsonFailure): JsonParseError {
  const position: JsonErrorPosition = { line: failure.line, column: failure.column, position: failure.position }
  return new JsonParseError(`invalid JSON at line ${failure.line}, column ${failure.column}`, position)
}

export type { JsonErrorPosition }