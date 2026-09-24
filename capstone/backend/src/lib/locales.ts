/**
 * System-wide locales (capstone-ui it1). Const-type pattern (typescript
 * skill): const object + mapped union — never bare string unions. Single
 * source for the 'es' | 'en' whitelist used by the migration CHECK
 * (007_locale.sql), the auth PATCH DTO and the notification templates.
 */
export const LOCALES = {
  es: 'es',
  en: 'en',
} as const

export type Locale = (typeof LOCALES)[keyof typeof LOCALES]

export const LOCALE_VALUES: readonly Locale[] = Object.values(LOCALES)