import { useLocale } from './LocaleContext.tsx'
import { en } from './locales/en.ts'
import { es } from './locales/es.ts'
import type { Dictionary, Locale, MessageKey, MessageParams, TFunction } from './types.ts'

const DICTIONARIES: Record<Locale, Dictionary> = { es, en }

/**
 * Pure translation core (extract-before-mock: unit tests call this directly
 * with a dictionary — no provider needed). Replaces every `{token}` in the
 * dictionary value with the given params.
 */
export function translate(
  dictionary: Dictionary,
  key: MessageKey,
  params?: MessageParams,
): string {
  let message = dictionary[key]
  if (params) {
    for (const [token, value] of Object.entries(params)) {
      message = message.replaceAll(`{${token}}`, String(value))
    }
  }
  return message
}

export interface UseTranslationResult {
  t: TFunction
  locale: Locale
  setLocale: (next: Locale) => void
}

/**
 * Translation function for the active locale plus the locale itself and its
 * setter. React Compiler memoizes the returned object.
 */
export function useTranslation(): UseTranslationResult {
  const { locale, setLocale } = useLocale()
  const t: TFunction = (key, params?: MessageParams) => translate(DICTIONARIES[locale], key, params)
  return { t, locale, setLocale }
}