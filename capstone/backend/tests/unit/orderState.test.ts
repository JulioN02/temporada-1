import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ORDER_STATES } from '../../src/modules/orders/dto.ts'
import { canTransition } from '../../src/modules/orders/service.ts'

/**
 * Order status machine (T-3-4, R-ORD-3): draft → confirmed, draft → cancelled,
 * confirmed → cancelled. Any other transition is invalid (409 INVALID_STATE
 * at the API layer). Pure function — no DB.
 */
describe('orders status machine (T-3-4, R-ORD-3)', () => {
  it('R-ORD-3: draft may transition to confirmed and cancelled', () => {
    assert.equal(canTransition(ORDER_STATES.draft, ORDER_STATES.confirmed), true)
    assert.equal(canTransition(ORDER_STATES.draft, ORDER_STATES.cancelled), true)
  })

  it('R-ORD-3: confirmed may transition to cancelled only', () => {
    assert.equal(canTransition(ORDER_STATES.confirmed, ORDER_STATES.cancelled), true)
    assert.equal(canTransition(ORDER_STATES.confirmed, ORDER_STATES.confirmed), false)
    assert.equal(canTransition(ORDER_STATES.confirmed, ORDER_STATES.draft), false)
  })

  it('R-ORD-3: cancelled is terminal — no transitions out', () => {
    assert.equal(canTransition(ORDER_STATES.cancelled, ORDER_STATES.draft), false)
    assert.equal(canTransition(ORDER_STATES.cancelled, ORDER_STATES.confirmed), false)
    assert.equal(canTransition(ORDER_STATES.cancelled, ORDER_STATES.cancelled), false)
  })
})