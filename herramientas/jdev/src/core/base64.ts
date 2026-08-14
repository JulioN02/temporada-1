import { Base64Error } from './errors.ts'

// Buffer.from(base64) silently ignores invalid characters — STRICT pre-validation
// is REQUIRED (design D-rule): alphabet + trailing-padding shape + length % 4.
const STD_RE = /^[A-Za-z0-9+/]*={0,2}$/
const URL_RE = /^[A-Za-z0-9_-]*={0,2}$/

export interface EncodeOptions {
  /** base64url alphabet (RFC 4648 §5): + -> -, / -> _ */
  url?: boolean
  /** add "=" padding; default true for standard, FALSE for url (JWT-style) */
  padding?: boolean
}

export interface DecodeOptions {
  /** accept the base64url alphabet; unpadded input is allowed */
  url?: boolean
}

/** Encode bytes. Standard mode is padded by default; url mode is unpadded by default. */
export function encodeBase64(input: Buffer, opts: EncodeOptions = {}): string {
  let out = input.toString('base64')
  if (opts.url) out = out.replace(/\+/g, '-').replace(/\//g, '_')
  const padded = opts.padding ?? !opts.url
  if (!padded) out = out.replace(/=+$/, '')
  return out
}

/** Strictly decode base64 text. Invalid alphabet or malformed padding -> Base64Error (exit 2). */
export function decodeBase64(input: string, opts: DecodeOptions = {}): Buffer {
  const re = opts.url ? URL_RE : STD_RE
  if (!re.test(input)) {
    throw new Base64Error('invalid base64 input: only the base64 alphabet (and up to two trailing "=") is allowed')
  }
  if (opts.url) {
    const hasPadding = input.includes('=')
    if (hasPadding && input.length % 4 !== 0) {
      throw new Base64Error('invalid base64 input: malformed padding')
    }
    // base64url decodes unpadded input: restore padding to a multiple of 4.
    if (!hasPadding) input = input + '='.repeat((4 - (input.length % 4)) % 4)
  } else if (input.length % 4 !== 0) {
    // Standard base64 is padded by contract; reject sloppy unpadded input.
    throw new Base64Error('invalid base64 input: length must be a multiple of 4 (standard base64 is padded)')
  }
  return Buffer.from(input, 'base64')
}