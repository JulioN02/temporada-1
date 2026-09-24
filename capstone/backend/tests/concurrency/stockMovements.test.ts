import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Pool } from 'pg'
import crypto from 'node:crypto'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'

/**
 * it4 concurrency proof (T-4-2 RED + T-4-8, R-STK-5) vs real Postgres 16:
 * advisory locks serialize writers — deterministic outcomes, NO timing sleeps.
 */

let ctx: TestContext
let pool: Pool

beforeEach(async () => {
  ctx = createTestContext()
  pool = ctx.pool
  await resetDatabase(pool)
})

describe('stock movement concurrency (T-4-2, T-4-8, R-STK-5)', () => {
  it('R-STK-5: parallel +5 adjustments -> all 201 and level 20 (sequential result, no lost update)', async () => {
    await createUser(pool, { username: 'cmgr', email: 'cmgr@test.local', password: 'Manager1', role: 'manager' })
    await createUser(pool, { username: 'cop', email: 'cop@test.local', password: 'Operator1', role: 'operator' })
    const managerToken = await loginAndGetToken(ctx.app, 'cmgr', 'Manager1')
    const operatorToken = await loginAndGetToken(ctx.app, 'cop', 'Operator1')

    const product = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Race Widget', sku: 'RACE-1' })
    const warehouse = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Race WH' })

    const productId = product.body.product.id as string
    const warehouseId = warehouse.body.warehouse.id as string

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(ctx.app)
          .post('/api/stock/movements')
          .set('Authorization', `Bearer ${operatorToken}`)
          .set('Idempotency-Key', crypto.randomUUID())
          .send({
            type: 'adjustment',
            productId,
            warehouseId,
            quantity: 5,
            reason: 'parallel stock increase',
          }),
      ),
    )
    assert.deepEqual(
      responses.map((r) => r.status),
      [201, 201, 201, 201],
      `all parallel adjustments must succeed: ${JSON.stringify(responses.map((r) => r.status))}`,
    )

    const level = await request(ctx.app)
      .get(`/api/stock?productId=${productId}&warehouseId=${warehouseId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
    assert.equal(level.status, 200)
    assert.equal(level.body.items[0]!.level, '20', '4 × +5 = 20, no lost update')
  })

  it('R-STK-5: stock 2 with 5 concurrent -1 adjustments -> exactly 2×201, 3×409, final level 0, never negative', async () => {
    await createUser(pool, { username: 'cmgr2', email: 'cmgr2@test.local', password: 'Manager1', role: 'manager' })
    await createUser(pool, { username: 'cop2', email: 'cop2@test.local', password: 'Operator1', role: 'operator' })
    const managerToken = await loginAndGetToken(ctx.app, 'cmgr2', 'Manager1')
    const operatorToken = await loginAndGetToken(ctx.app, 'cop2', 'Operator1')

    const product = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Race Widget 2', sku: 'RACE-2' })
    const warehouse = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Race WH 2' })
    const productId = product.body.product.id as string
    const warehouseId = warehouse.body.warehouse.id as string

    const seed = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        type: 'adjustment',
        productId,
        warehouseId,
        quantity: 2,
        reason: 'race seed stock',
      })
    assert.equal(seed.status, 201)

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(ctx.app)
          .post('/api/stock/movements')
          .set('Authorization', `Bearer ${operatorToken}`)
          .set('Idempotency-Key', crypto.randomUUID())
          .send({
            type: 'adjustment',
            productId,
            warehouseId,
            quantity: -1,
            reason: 'parallel stock decrease',
          }),
      ),
    )
    const statuses = responses.map((r) => r.status)
    assert.equal(statuses.filter((s) => s === 201).length, 2, `exactly 2×201: ${JSON.stringify(statuses)}`)
    assert.equal(statuses.filter((s) => s === 409).length, 3, `exactly 3×409: ${JSON.stringify(statuses)}`)
    for (const r of responses) {
      if (r.status === 409) assert.equal(r.body.error.code, 'NEGATIVE_STOCK')
    }

    const level = await request(ctx.app)
      .get(`/api/stock?productId=${productId}&warehouseId=${warehouseId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
    assert.equal(level.body.items[0]!.level, '0', 'final level 0 — the invariant held under racing writers')

    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)
    assert.equal(rows[0]!.n, 3, 'seed + exactly 2 successful movements')
  })
})