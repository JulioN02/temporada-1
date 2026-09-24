import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'

/**
 * it4 atomic-showpiece concurrency (T-4-8, R-ORD-5) vs real Postgres 16:
 * deterministic advisory-lock interleavings — one 200 + one 409, exactly one
 * movement set, invariant holds. NO timing sleeps (tasks.md risk note).
 */

let ctx: TestContext
let pool: Pool

beforeEach(async () => {
  ctx = createTestContext()
  pool = ctx.pool
  await resetDatabase(pool)
})

describe('atomic confirm concurrency (T-4-8, R-ORD-5)', () => {
  async function seed(orderQty: number, stock: number) {
    await createUser(pool, { username: 'ocmgr', email: 'ocmgr@test.local', password: 'Manager1', role: 'manager' })
    await createUser(pool, { username: 'ocop', email: 'ocop@test.local', password: 'Operator1', role: 'operator' })
    const managerToken = await loginAndGetToken(ctx.app, 'ocmgr', 'Manager1')
    const operatorToken = await loginAndGetToken(ctx.app, 'ocop', 'Operator1')

    const customer = await request(ctx.app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Race Customer', email: 'racec@test.local' })
    const product = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Race Atomic', sku: 'RACE-ATOMIC' })
    const warehouse = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Race Atomic WH' })
    const productId = product.body.product.id as string
    const warehouseId = warehouse.body.warehouse.id as string

    const adjust = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ type: 'adjustment', productId, warehouseId, quantity: stock, reason: 'race seed stock' })
    assert.equal(adjust.status, 201)

    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        customerId: customer.body.customer.id as string,
        lines: [{ productId, qty: orderQty, unitPrice: '1.00' }],
      })
    assert.equal(order.status, 201)
    return { managerToken, operatorToken, productId, warehouseId, orderId: order.body.order.id as string }
  }

  it('R-ORD-5: two concurrent confirms (different keys) -> exactly one 200, one 409, 1 movement set', async () => {
    const s = await seed(3, 10)
    const [a, b] = await Promise.all([
      request(ctx.app).post(`/api/orders/${s.orderId}/confirm`).set('Authorization', `Bearer ${s.operatorToken}`).set('Idempotency-Key', 'race-k1'),
      request(ctx.app).post(`/api/orders/${s.orderId}/confirm`).set('Authorization', `Bearer ${s.operatorToken}`).set('Idempotency-Key', 'race-k2'),
    ])
    const statuses = [a.status, b.status].sort()
    assert.deepEqual(statuses, [200, 409], `one winner, one loser: ${JSON.stringify(statuses)}`)
    const loser = a.status === 409 ? a : b
    assert.equal(loser.body.error.code, 'INVALID_STATE', 'loser sees the committed confirmed state')

    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)
    assert.equal(rows[0]!.n, 2, 'seed adjustment + exactly ONE order_out movement set')
    const orderState = await pool.query(`SELECT state FROM orders WHERE id = $1`, [s.orderId])
    assert.equal(orderState.rows[0]!.state, 'confirmed')
    const audit = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'order.confirm'`)
    assert.equal(audit.rows[0]!.n, 1, 'exactly one order.confirm audit row')
  })

  it('R-ORD-5: concurrent adjust vs confirm on the same product -> one wins, invariant holds (never negative)', async () => {
    const s = await seed(3, 3) // stock exactly 3: confirm needs 3, adjust -3 needs 3
    const [confirmRes, adjustRes] = await Promise.all([
      request(ctx.app).post(`/api/orders/${s.orderId}/confirm`).set('Authorization', `Bearer ${s.operatorToken}`).set('Idempotency-Key', 'race-adj-k1'),
      request(ctx.app).post('/api/stock/movements').set('Authorization', `Bearer ${s.operatorToken}`).set('Idempotency-Key', 'race-adj-k2').send({
        type: 'adjustment',
        productId: s.productId,
        warehouseId: s.warehouseId,
        quantity: -3,
        reason: 'racing stock decrease',
      }),
    ])
    const ok = [confirmRes.status, adjustRes.status].filter((st) => st === 200 || st === 201)
    const ko = [confirmRes.status, adjustRes.status].filter((st) => st === 409)
    assert.equal(ok.length, 1, `exactly one op consumes the stock: ${JSON.stringify([confirmRes.status, adjustRes.status])}`)
    assert.equal(ko.length, 1, `exactly one op is rejected: ${JSON.stringify([confirmRes.status, adjustRes.status])}`)

    const level = await request(ctx.app)
      .get(`/api/stock?productId=${s.productId}&warehouseId=${s.warehouseId}`)
      .set('Authorization', `Bearer ${s.operatorToken}`)
    const finalLevel = Number(level.body.items[0]!.level)
    assert.ok(finalLevel >= 0, `final level must never be negative, got ${finalLevel}`)
    assert.equal(finalLevel, 0, 'stock 3 fully consumed by exactly one op')

    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)
    assert.equal(rows[0]!.n, 2, 'seed + exactly one winner movement (adjustment OR order_out)')
  })
})