import type { Locale } from './types.ts'

/**
 * Locale-aware D13 money / date formatting (capstone-ui it2a, T-2-4 —
 * R-UI-ORD-6, design ADR-5). Money is FLOAT-FREE BY CONSTRUCTION: the D13
 * string is split on '.', the integer part (≤ 1e11 « 2^53) is grouped via
 * Intl.NumberFormat integer-only grouping (exact), the decimal part stays a
 * string. `Number()` is NEVER applied to money as a float.
 */

// `useGrouping: 'always'` forces the thousands separator for 4-digit
// numbers (CLDR es would otherwise render 1234 as "1234").
const integerGroupers: Record<Locale, Intl.NumberFormat> = {
  es: new Intl.NumberFormat('es-ES', { useGrouping: 'always' }),
  en: new Intl.NumberFormat('en-US', { useGrouping: 'always' }),
}

const dateTimeFormatters: Record<Locale, Intl.DateTimeFormat> = {
  es: new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
  en: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
}

/**
 * D13 "12.50" → es "12,50 €" (comma decimals, € suffix) / en "$12.50"
 * (dot decimals, $ prefix). Grouped integer part per locale.
 */
export function formatMoney(d13: string, locale: Locale): string {
  const [intPart, decPart] = d13.split('.')
  const normalizedInt = intPart === '' ? '0' : intPart
  const decimals = (decPart ?? '').padEnd(2, '0').slice(0, 2)
  const grouped = integerGroupers[locale].format(Number(normalizedInt))
  if (locale === 'es') {
    return `${grouped},${decimals} €`
  }
  return `$${grouped}.${decimals}`
}

/**
 * Input parsing: strips group separators (es: dots; en: commas), maps the
 * decimal comma → dot, validates scale ≤ 2 and returns the normalized
 * "12.50" payload string (R-UI-ORD-6 round-trip). Invalid input → null
 * (client-side block — no request fires).
 */
export function parseMoney(input: string, locale: Locale): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const normalized =
    locale === 'es' ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed.replaceAll(',', '')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [int, dec] = normalized.split('.')
  return dec === undefined ? `${int}.00` : `${int}.${dec.padEnd(2, '0')}`
}

/** Locale-aware number formatting; NaN falls back to the raw input. */
export function formatNumber(value: string | number, locale: Locale): string {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(parsed)) return String(value)
  return integerGroupers[locale].format(parsed)
}

/** Locale-aware date/time; Invalid Date falls back to the raw input. */
export function formatDateTime(value: string | number | Date, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return dateTimeFormatters[locale].format(date)
}