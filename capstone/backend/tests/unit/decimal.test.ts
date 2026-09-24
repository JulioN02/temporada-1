import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { add, decimalString, format2, mul, positiveDecimalString } from '../../src/lib/decimal.ts'

/**
 * D13 exact string money (T-3-2, ADR-8, R-ORD-2): numerics travel as strings,
 * math is integer-based (cents), never JS float. Unit tests prove the exact
 * arithmetic contract; the DTO-level 422 comes from the zod schemas.
 */
describe('lib/decimal.ts (T-3-2, R-ORD-2)', () => {
  it('R-ORD-2: exact multiplication — 0.10 × 3 = "0.30" (never 0.30000000000000004)', () => {
    assert.equal(mul('3', '0.10'), '0.30')
  })

  it('R-ORD-2: exact multiplication with mixed scales — 2 × 12.5 = "25.00"', () => {
    assert.equal(mul('2', '12.5'), '25.00')
  })

  it('R-ORD-2: addition keeps exact cents — 0.10 + 0.20 = "0.30"', () => {
    assert.equal(add('0.10', '0.20'), '0.30')
  })

  it('R-ORD-2: addition over the integer boundary — 9.99 + 0.01 = "10.00"', () => {
    assert.equal(add('9.99', '0.01'), '10.00')
  })

  it('R-ORD-2: serialization — format2 canonicalizes to exactly 2 decimals ("12.5" → "12.50")', () => {
    assert.equal(format2('12.5'), '12.50')
    assert.equal(format2('12'), '12.00')
    assert.equal(format2('0.1'), '0.10')
  })

  it('R-ORD-2: precision — scale > 2 rejected by the DTO schema ("0.001" → invalid)', () => {
    assert.equal(decimalString(2).safeParse('0.001').success, false)
    assert.equal(decimalString(2).safeParse('0.10').success, true)
    assert.equal(decimalString(2).safeParse('12.5').success, true)
  })

  it('R-ORD-2: negative or malformed money rejected by the schema', () => {
    assert.equal(decimalString(2).safeParse('-1.00').success, false)
    assert.equal(decimalString(2).safeParse('abc').success, false)
    assert.equal(decimalString(2).safeParse('1.2.3').success, false)
  })

  it('positiveDecimalString requires a magnitude greater than zero', () => {
    assert.equal(positiveDecimalString(2).safeParse('0.00').success, false)
    assert.equal(positiveDecimalString(2).safeParse('0.01').success, true)
  })
})