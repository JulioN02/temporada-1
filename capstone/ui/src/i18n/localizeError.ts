import type { MessageKey, TFunction } from './types.ts'

/**
 * Backend error code → dictionary key (R-I18N-4, design ADR-5). Covers the
 * full backend error contract: UNAUTHORIZED/FORBIDDEN/NOT_FOUND, every 409
 * CONFLICT subcode (incl. the it1-additive WAREHOUSE_IN_USE), the bare
 * CONFLICT subcode (warehouse duplicate-name — reported at it1, stock
 * service), VALIDATION_ERROR and INTERNAL_ERROR; UNKNOWN is the fallback.
 * Const object + derived union (typescript skill — no bare string unions).
 */
export const ERROR_MESSAGE_KEYS = {
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.notFound',
  USERNAME_TAKEN: 'errors.conflict.usernameTaken',
  DUPLICATE_EMAIL: 'errors.conflict.duplicateEmail',
  DUPLICATE_SKU: 'errors.conflict.duplicateSku',
  INVALID_STATE: 'errors.conflict.invalidState',
  INSUFFICIENT_STOCK: 'errors.conflict.insufficientStock',
  NEGATIVE_STOCK: 'errors.conflict.negativeStock',
  WAREHOUSE_IN_USE: 'errors.conflict.warehouseInUse',
  CONFLICT: 'errors.conflict.generic',
  VALIDATION_ERROR: 'errors.validation',
  INTERNAL_ERROR: 'errors.internal',
  UNKNOWN: 'errors.unknown',
} as const satisfies Record<string, MessageKey>

export type ErrorCode = keyof typeof ERROR_MESSAGE_KEYS

/** Resolve any raw code string to a dictionary key, falling back to UNKNOWN. */
export function lookupErrorKey(code: string): MessageKey {
  if (code in ERROR_MESSAGE_KEYS) {
    return ERROR_MESSAGE_KEYS[code as ErrorCode]
  }
  return ERROR_MESSAGE_KEYS.UNKNOWN
}

/**
 * Structural guard: any object carrying a string `code` (the client error
 * envelope `{status, code, message}` and the backend `{error:{code}}` both
 * qualify). Structural — keeps the i18n module independent of api/client
 * (apply decision, reported at it2a).
 */
function isErrorLike(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  )
}

/**
 * Central error localizer (R-I18N-4): backend codes map to localized friendly
 * messages; unknown codes and non-error values fall back to the generic
 * localized message. Raw server messages are NEVER rendered (design ADR-5).
 */
export function localizeError(error: unknown, t: TFunction): string {
  if (isErrorLike(error)) {
    return t(lookupErrorKey(error.code))
  }
  return t(ERROR_MESSAGE_KEYS.UNKNOWN)
}