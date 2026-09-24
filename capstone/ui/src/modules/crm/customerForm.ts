import type { TFunction } from '../../i18n/types.ts'

/**
 * Customer form validation (it3 T-3-3 — R-UI-CRM-2). Pure function with the
 * translator injected (extract-before-mock): empty name and malformed email
 * are blocked CLIENT-SIDE before any request fires. Email is optional in the
 * API contract — an empty email passes; a present one must be well-formed.
 */
export interface CustomerFormInput {
  name: string
  email: string
}

export function validateCustomerInput(
  input: CustomerFormInput,
  t: TFunction,
): { name?: string | undefined; email?: string | undefined } {
  const errors: { name?: string | undefined; email?: string | undefined } = {}
  if (input.name.trim() === '') {
    errors.name = t('crm.customer.nameRequired')
  }
  const email = input.email.trim()
  if (email !== '' && !/^\S+@\S+\.\S+$/.test(email)) {
    errors.email = t('crm.customer.emailInvalid')
  }
  return errors
}

/** Basic email format check used by the edit flow (same rule). */
export function isEmailValid(email: string): boolean {
  const trimmed = email.trim()
  return trimmed === '' || /^\S+@\S+\.\S+$/.test(trimmed)
}