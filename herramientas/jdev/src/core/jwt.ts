import { decodeBase64 } from './base64.ts'
import { JwtError } from './errors.ts'

export interface DecodedJwt {
  header: unknown
  payload: unknown
}

/**
 * Decode-only JWT inspection (security-critical):
 * - PART COUNT: exactly 3 dot-separated parts, else JwtError.
 * - STRICT base64url decode per part (reuses core/base64 — unpadded accepted).
 * - header/payload MUST parse as JSON.
 * - The SIGNATURE part is NEVER decoded, returned or printed.
 * - No verify/compare capability exists: there is no secret-taking parameter
 *   anywhere in this module (capability absent BY CONSTRUCTION).
 */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new JwtError(`expected 3 parts, got ${parts.length}`)
  }
  const header = parsePart(parts[0]!, 'header')
  const payload = parsePart(parts[1]!, 'payload')
  return { header, payload }
}

function parsePart(part: string, name: 'header' | 'payload'): unknown {
  let bytes: Buffer
  try {
    bytes = decodeBase64(part, { url: true })
  } catch {
    // Do NOT echo the part content — failing paths must not leak token material.
    throw new JwtError(`invalid base64url in ${name} part`)
  }
  const text = bytes.toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new JwtError(`${name} part is not valid JSON`)
  }
}