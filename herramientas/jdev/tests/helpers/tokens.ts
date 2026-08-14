/** Static JWT fixtures for the jwt suite (classic HS256 RFC 7519 example). */
export const CLASSIC_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

/** Signature part of the classic token — MUST never appear in any output. */
export const CLASSIC_SIGNATURE = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

/** Valid base64url header part of the classic token. */
export const CLASSIC_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

/** Token with 2 parts only (no signature segment). */
export const TWO_PART_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ'

/** Invalid base64url in the HEADER part (`!!!` is outside the alphabet). */
export const INVALID_B64_TOKEN = '!!!.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'

/** Invalid base64url in the PAYLOAD part. */
export const INVALID_B64_PAYLOAD_TOKEN = `${CLASSIC_HEADER}.!!!.sig`

/** Payload part is valid base64url but decodes to the plain text `not json`. */
export const NON_JSON_PAYLOAD_TOKEN = `${CLASSIC_HEADER}.bm90IGpzb24.somesig`

/** Header part is valid base64url but decodes to the plain text `not json`. */
export const NON_JSON_HEADER_TOKEN = `bm90IGpzb24.eyJzdWIiOiIxMjM0NTY3ODkwIn0.somesig`