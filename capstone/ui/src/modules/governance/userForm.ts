import type { TFunction, MessageKey } from '../../i18n/types.ts'
import type { Role } from '../../api/types.ts'

/**
 * User create/edit form validation (it5 T-5-3/T-5-4 — R-UI-USR-2/3).
 * Pure functions with the translator injected (extract-before-mock): weak
 * usernames/passwords/emails are blocked CLIENT-SIDE before any request.
 * Mirrors the backend zod contracts: username 3-50 [A-Za-z0-9_],
 * password 12-128 with ≥1 letter and ≥1 digit (R-AUTH-6).
 */
export interface UserFormInput {
  username: string
  fullName: string
  email: string
  role: string
  password: string
}

export function validateUsername(username: string, t: TFunction): string | null {
  if (!/^[A-Za-z0-9_]{3,50}$/.test(username.trim())) {
    return t('users.usernameInvalid')
  }
  return null
}

export function validatePassword(password: string, t: TFunction): string | null {
  const value = password
  if (value.length < 12 || value.length > 128) return t('users.passwordStrength')
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return t('users.passwordStrength')
  return null
}

export function validateEmail(email: string, t: TFunction): string | null {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return t('users.emailInvalid')
  return null
}

/** Full create-form validation → field errors (R-UI-USR-2 scenarios). */
export function validateCreateUserInput(
  input: UserFormInput,
  t: TFunction,
): { username?: string | undefined; email?: string | undefined; password?: string | undefined } {
  const errors: { username?: string | undefined; email?: string | undefined; password?: string | undefined } = {}
  const usernameError = validateUsername(input.username, t)
  if (usernameError) errors.username = usernameError
  const emailError = validateEmail(input.email, t)
  if (emailError) errors.email = emailError
  const passwordError = validatePassword(input.password, t)
  if (passwordError) errors.password = passwordError
  return errors
}

/** Localized role badge/select labels (R-UI-USR-1: role display localized). */
export const ROLE_LABEL_KEYS: Readonly<Record<Role, MessageKey>> = {
  admin: 'users.role.admin',
  manager: 'users.role.manager',
  operator: 'users.role.operator',
  viewer: 'users.role.viewer',
  auditor: 'users.role.auditor',
}

export function roleLabelKey(role: Role): MessageKey {
  return ROLE_LABEL_KEYS[role]
}