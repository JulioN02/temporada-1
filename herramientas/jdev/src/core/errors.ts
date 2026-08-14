/** Base class for all jdev runtime errors: stable `code` + exit mapping. */
export class JdevError extends Error {
  readonly exitCode: number = 2
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** File/system errors (missing file, read failure) → exit 2. */
export class IoError extends JdevError {
  constructor(message: string, code = 'IO_READ') {
    super(code, message)
  }
}

/** Usage-level errors commander cannot express → exit 1. */
export class UsageError extends JdevError {
  override readonly exitCode = 1

  constructor(message: string, code = 'USAGE') {
    super(code, message)
  }
}

/** JSON parsing/validation failures (invalid data) → exit 2, carries position info. */
export interface JsonErrorPosition {
  line: number
  column: number
  position: number
}

export class JsonParseError extends JdevError {
  readonly position: JsonErrorPosition

  constructor(message: string, position: JsonErrorPosition) {
    super('INVALID_JSON', message)
    this.position = position
  }
}

/** Base64 decode failures (invalid characters/length) → exit 2. */
export class Base64Error extends JdevError {
  constructor(message: string, code = 'INVALID_BASE64') {
    super(code, message)
  }
}

/** Epoch argument failures (non-numeric) → exit 2. */
export class TimestampError extends JdevError {
  constructor(message: string, code = 'INVALID_EPOCH') {
    super(code, message)
  }
}
