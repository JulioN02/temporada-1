import { en } from './locales/en.ts'

/**
 * i18n core types (capstone-ui it2a, T-2-4) — flat dotted keys, derived from
 * the `en` dictionary (design ADR-2 / tasks T-2-4: `MessageKey = keyof typeof
 * en`), so a key missing from `en` is a tsc error at every usage site and a
 * key missing from `es` fails the `satisfies Dictionary` check at compile
 * time; the runtime parity test (R-I18N-1) covers both directions.
 */
export const LOCALES = { es: 'es', en: 'en' } as const
export type Locale = (typeof LOCALES)[keyof typeof LOCALES]

/** Every valid message key, derived from the source-of-truth dictionary. */
export type MessageKey = keyof typeof en

/** A complete locale dictionary — all keys present, all values strings. */
export type Dictionary = Record<MessageKey, string>

/** Interpolation params, e.g. `{ username: 'ada' }` replaces `{username}`. */
export type MessageParams = Record<string, string | number>

/** Translation function exposed by `useTranslation`. */
export type TFunction = (key: MessageKey, params?: MessageParams) => string