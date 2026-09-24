import { z } from 'zod'

/**
 * D13 exact string money (T-3-2, ADR-8, R-ORD-2). Numerics travel as strings
 * end-to-end: node-postgres returns NUMERIC as string, JSON serialization is
 * pass-through. Math is integer-based (cents), never JS float:
 *   mul('3', '0.10') === '0.30'   (never 0.30000000000000004)
 *   add('0.10', '0.20') === '0.30'
 *   format2('12.5') === '12.50'   (exactly 2 decimals)
 *
 * Values are bounded by NUMERIC(13,2): |value| < 10^11 — cents fit safely in
 * JS Number (≤ 9e15 integer precision), so all arithmetic below is exact.
 * Inputs are validated by the zod schemas (scale ≤ 2) BEFORE any math runs.
 */

/** Branded type for validated money values (ADR-8: DecimalString). */
export interface DecimalStringBrand {
  readonly __decimalStringBrand: unique symbol
}
export type DecimalString = string & DecimalStringBrand

/** Parses a non-negative decimal string into integer cents ("12.5" → 1250). */
export function toCents(value: string): number {
  const negative = value.startsWith('-')
  const cleaned = value.replace(/^[+-]/, '')
  const [intPart, fracPart] = cleaned.split('.')
  const int = Number(intPart ?? '0')
  const frac = Number((fracPart ?? '').padEnd(2, '0').slice(0, 2))
  const cents = int * 100 + frac
  return negative ? -cents : cents
}

/** Formats integer cents into a canonical 2-decimal string (1250 → "12.50"). */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const int = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}${int}.${String(frac).padStart(2, '0')}`
}

/**
 * Exact multiplication (string × string). Exact whenever the product fits
 * scale ≤ 2 (the only supported use: integer quantity × scale ≤ 2 price);
 * otherwise rounds half-up to the nearest cent.
 */
export function mul(a: string, b: string): string {
  const productCents = toCents(a) * toCents(b)
  return fromCents(Math.round(productCents / 100))
}

/** Exact addition of two decimal strings. */
export function add(a: string, b: string): string {
  return fromCents(toCents(a) + toCents(b))
}

/** Canonicalizes any scale ≤ 2 decimal string to exactly 2 decimals. */
export function format2(value: string): string {
  return fromCents(toCents(value))
}

/**
 * Zod schema for a non-negative decimal string with a maximum scale
 * (ported from inventory-stock lib/decimal.ts; JSON numbers accepted and
 * canonicalized to strings — never parsed as floats).
 */
export function decimalString(maxScale: number) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .refine((value) => /^\d+(\.\d+)?$/.test(value), {
      message: 'must be a non-negative decimal number',
    })
    .refine((value) => {
      const parts = value.split('.')
      return parts.length === 1 || (parts[1]?.length ?? 0) <= maxScale
    }, { message: `must have at most ${maxScale} decimal place(s)` })
}

/** Positive decimal string (magnitude always > 0). */
export function positiveDecimalString(maxScale: number) {
  return decimalString(maxScale).refine((value) => toCents(value) > 0, {
    message: 'must be greater than zero',
  })
}