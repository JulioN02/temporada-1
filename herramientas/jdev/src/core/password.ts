import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { BcryptLengthError } from './errors.ts'

/**
 * Shared 72-byte guard: bcrypt silently truncates input at 72 bytes, so we reject
 * oversized passwords BEFORE bcryptjs sees them — in BOTH hash and verify paths
 * (no silent truncation, no length-timing oracle before compare).
 * The limit is UTF-8 BYTE length, not char count (multibyte gotcha).
 */
export function assertBcryptBytes(pw: string): void {
  if (Buffer.byteLength(pw, 'utf8') > 72) {
    throw new BcryptLengthError('password exceeds the 72-byte bcrypt limit (utf8 byte length, not char count)')
  }
}

/** bcrypt hash (default cost 10) of a password ≤72 utf8 bytes. */
export function hashPassword(pw: string, cost = 10): string {
  assertBcryptBytes(pw)
  return bcrypt.hashSync(pw, cost)
}

/** Canonical bcrypt hash shape: $2a|2b|2y$ + 2-digit cost + 53-char ./A-Za-z0-9 tail. */
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export interface VerifyResult {
  ok: boolean
  /** hash did not match the bcrypt format — flagged (not thrown) so the CLI decides messaging */
  malformed: boolean
}

/**
 * Timing-safe verify: length/format-guard FIRST (malformed hashes never reach the
 * compare), then bcryptjs.compareSync (constant-time). Malformed input is FLAGGED
 * so callers can distinguish "wrong password" (silent) from "bad hash" (explained).
 */
export function verifyPassword(pw: string, hash: string): VerifyResult {
  assertBcryptBytes(pw)
  if (!BCRYPT_HASH_RE.test(hash)) return { ok: false, malformed: true }
  return { ok: bcrypt.compareSync(pw, hash), malformed: false }
}

/** 64-char printable alphabet → one byte maps to one char via & 63: uniform, exact length. */
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/** Crypto-only random printable password (randomBytes, never Math.random). */
export function generatePassword(length = 16): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const b of bytes) out += CHARSET.charAt(b & 63)
  return out
}
