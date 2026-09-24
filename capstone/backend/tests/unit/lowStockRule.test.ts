import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lowStockShouldFire } from '../../src/modules/stock/events.ts'

/**
 * T-4-3 RED: low-stock choke-point rule (ADR-5, R-STK-7). Pure function —
 * fires iff sign = −1 AND new level < threshold. "6→4 fires", "4→3 fires
 * again (already low)", "8→6 no fire", positive never fires, boundary
 * (new level == threshold) does not fire.
 */
describe('low-stock choke rule (T-4-3, R-STK-7, ADR-5)', () => {
  it('R-STK-7: crossing — level 6 → 4 with threshold 5 fires', () => {
    assert.equal(lowStockShouldFire({ sign: -1, newLevel: 4, threshold: 5 }), true)
  })

  it('R-STK-7: not crossing — level 8 → 6 (still >= threshold 5) does not fire', () => {
    assert.equal(lowStockShouldFire({ sign: -1, newLevel: 6, threshold: 5 }), false)
  })

  it('R-STK-7: already low — level 4 → 3 fires again (each crossing movement notifies)', () => {
    assert.equal(lowStockShouldFire({ sign: -1, newLevel: 3, threshold: 5 }), true)
  })

  it('R-STK-7: boundary — new level exactly equal to threshold does not fire (strict <)', () => {
    assert.equal(lowStockShouldFire({ sign: -1, newLevel: 5, threshold: 5 }), false)
  })

  it('R-STK-7: positive movements never fire', () => {
    assert.equal(lowStockShouldFire({ sign: 1, newLevel: 4, threshold: 5 }), false)
  })

  it('R-STK-7: zero threshold — any negative movement lands below 0 and fires', () => {
    assert.equal(lowStockShouldFire({ sign: -1, newLevel: 0, threshold: 0 }), false, '0 < 0 is false')
    assert.equal(lowStockShouldFire({ sign: -1, newLevel: -1, threshold: 0 }), true)
  })
})