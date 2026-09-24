/**
 * T-2-4 (capstone-ui it2a) — D13 money formatting (R-UI-ORD-6, design ADR-5).
 * Float-free by construction: money NEVER passes through Number() as a float
 * — the integer part (≤ 1e11 « 2^53) is grouped via Intl.NumberFormat, the
 * decimal part is handled as a string.
 */
import { describe, it, expect } from 'vitest'
import { formatMoney, parseMoney, formatDateTime } from '../src/i18n/formatters.ts'

describe('R-UI-ORD-6: D13 money display (float-free)', () => {
  it('R-UI-ORD-6: es renders "12,50 €" (comma decimals, € suffix)', () => {
    expect(formatMoney('12.50', 'es')).toBe('12,50 €')
  })

  it('R-UI-ORD-6: en renders "$12.50" (dot decimals, $ prefix)', () => {
    expect(formatMoney('12.50', 'en')).toBe('$12.50')
  })

  it('R-UI-ORD-6: thousands grouping — es "1.234.567,89 €", en "$1,234,567.89"', () => {
    expect(formatMoney('1234567.89', 'es')).toBe('1.234.567,89 €')
    expect(formatMoney('1234567.89', 'en')).toBe('$1,234,567.89')
  })

  it('R-UI-ORD-6: zero and large-but-safe integer parts render exactly (no float drift)', () => {
    expect(formatMoney('0.00', 'es')).toBe('0,00 €')
    expect(formatMoney('99999999999.99', 'es')).toBe('99.999.999.999,99 €')
  })
})

describe('R-UI-ORD-6: parseMoney input parsing (round-trip)', () => {
  it('R-UI-ORD-6: es input "12,50" round-trips to the normalized "12.50" payload', () => {
    expect(parseMoney('12,50', 'es')).toBe('12.50')
  })

  it('R-UI-ORD-6: es input with group separators "1.234,56" normalizes to "1234.56"', () => {
    expect(parseMoney('1.234,56', 'es')).toBe('1234.56')
  })

  it('R-UI-ORD-6: en input "12.50" passes through; "1,234.56" normalizes', () => {
    expect(parseMoney('12.50', 'en')).toBe('12.50')
    expect(parseMoney('1,234.56', 'en')).toBe('1234.56')
  })

  it('R-UI-ORD-6: scale > 2 is rejected (null — client block, no request)', () => {
    expect(parseMoney('12.505', 'en')).toBeNull()
    expect(parseMoney('12,505', 'es')).toBeNull()
  })

  it('R-UI-ORD-6: single decimal digit pads to two; garbage returns null', () => {
    expect(parseMoney('12.5', 'en')).toBe('12.50')
    expect(parseMoney('12,5', 'es')).toBe('12.50')
    expect(parseMoney('abc', 'en')).toBeNull()
    expect(parseMoney('', 'es')).toBeNull()
  })
})

describe('R-UI-ORD-6: date formatting', () => {
  it('formats an ISO datetime per locale and falls back to the raw input on invalid dates', () => {
    const iso = '2026-01-06T10:30:00.000Z'
    expect(formatDateTime(iso, 'es')).toContain('2026')
    expect(formatDateTime(iso, 'en')).toContain('2026')
    expect(formatDateTime('not-a-date', 'es')).toBe('not-a-date')
  })
})