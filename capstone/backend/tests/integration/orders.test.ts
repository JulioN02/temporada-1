import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'

let ctx: TestContext
let pool: Pool

beforeEach(async () => {
  ctx = createTestContext()
  pool = ctx.pool
  await resetDatabase(pool)
})

afterEach(async () => {
  await pool.end()
})

/** Manager token — has stock:product_manage (matrix) to seed products. */
async function managerToken(): Promise<string> {
  await createUser(pool, { username: 'mgr', email: 'mgr@test.local', password: 'Manager1', role: 'manager' })
  return loginAndGetToken(ctx.app, 'mgr', 'Manager1')
}

async function operatorToken(): Promise<string> {
  await createUser(pool, { username: 'op', email: 'op@test.local', password: 'Operator1', role: 'operator' })
  return loginAndGetToken(ctx.app, 'op', 'Operator1')
}

async function viewerToken(): Promise<string> {
  await createUser(pool, { username: 'viewer1', email: 'viewer1@test.local', password: 'Viewer123', role: 'viewer' })
  return loginAndGetToken(ctx.app, 'viewer1', 'Viewer123')
}

interface Seed {
  managerToken: string
  operatorToken: string
  customerId: string
  productId: string
}

/**
 * Seeds a customer (operator) + product (manager); returns tokens + ids.
 * it4: also seeds a warehouse + stock level so confirm (now the atomic
 * composition, T-4-6) can succeed in the status-machine tests.
 */
async function seedBase(): Promise<Seed> {
  const manager = await managerToken()
  const operator = await operatorToken()
  const customer = await request(ctx.app)
    .post('/api/customers')
    .set('Authorization', `Bearer ${operator}`)
    .send({ name: 'Order Customer', email: 'orders@test.local' })
  assert.equal(customer.status, 201)
  const product = await request(ctx.app)
    .post('/api/products')
    .set('Authorization', `Bearer ${manager}`)
    .send({ name: 'Widget', sku: 'WIDGET-1', lowStockThreshold: 3 })
  assert.equal(product.status, 201)
  const warehouse = await request(ctx.app)
    .post('/api/warehouses')
    .set('Authorization', `Bearer ${manager}`)
    .send({ name: 'Orders WH' })
  assert.equal(warehouse.status, 201)
  const adjust = await request(ctx.app)
    .post('/api/stock/movements')
    .set('Authorization', `Bearer ${operator}`)
    .send({
      type: 'adjustment',
      productId: product.body.product.id as string,
      warehouseId: warehouse.body.warehouse.id as string,
      quantity: 10,
      reason: 'orders test seed stock',
    })
  assert.equal(adjust.status, 201)
  return {
    managerToken: manager,
    operatorToken: operator,
    customerId: customer.body.customer.id as string,
    productId: product.body.product.id as string,
  }
}

function orderBody(seed: Seed, overrides: Record<string, unknown> = {}) {
  return {
    customerId: seed.customerId,
    lines: [{ productId: seed.productId, qty: 3, unitPrice: '0.10' }],
    ...overrides,
  }
}

describe('orders integration (T-3-7, R-ORD-1..4, R-ORD-7)', () => {
  it('R-ORD-1: operator creates a 2-line order -> 201, state draft, lines persisted', async () => {
    const seed = await seedBase()
    const product2 = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Gadget', sku: 'GADGET-1' })
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        customerId: seed.customerId,
        lines: [
          { productId: seed.productId, qty: 3, unitPrice: '0.10' },
          { productId: product2.body.product.id as string, qty: 1, unitPrice: '9.99' },
        ],
      })
    assert.equal(res.status, 201)
    assert.equal(res.body.order.state, 'draft')
    assert.equal(res.body.order.customerId, seed.customerId)
    assert.equal(res.body.order.lines.length, 2)
    assert.equal(res.body.order.lines[0]!.productSku, 'WIDGET-1')
    assert.equal(res.body.order.lines[0]!.productName, 'Widget')
  })

  it('R-ORD-1: empty lines -> 422 VALIDATION_ERROR', async () => {
    const seed = await seedBase()
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [] })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-ORD-1: unknown product -> 422 VALIDATION_ERROR with UNKNOWN_PRODUCT (ADR-1)', async () => {
    const seed = await seedBase()
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: 999999, qty: 1, unitPrice: '1.00' }] })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    assert.match(res.body.error.message, /UNKNOWN_PRODUCT/)
  })

  it('R-ORD-1: unknown customer -> 422 VALIDATION_ERROR with UNKNOWN_CUSTOMER (ADR-1 parity)', async () => {
    const seed = await seedBase()
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: 999999, lines: [{ productId: seed.productId, qty: 1, unitPrice: '1.00' }] })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    assert.match(res.body.error.message, /UNKNOWN_CUSTOMER/)
  })

  it('R-ORD-1: qty must be an integer >= 1 -> 422', async () => {
    const seed = await seedBase()
    const zero = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 0, unitPrice: '1.00' }] })
    assert.equal(zero.status, 422)
    const frac = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 1.5, unitPrice: '1.00' }] })
    assert.equal(frac.status, 422)
  })

  it('R-ORD-2: exact string money — 3 × 0.10 = total "0.30" (never float artifacts)', async () => {
    const seed = await seedBase()
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    assert.equal(res.status, 201)
    assert.equal(res.body.order.total, '0.30')
    assert.equal(res.body.order.lines[0]!.lineTotal, '0.30')
  })

  it('R-ORD-2: serialization — total 12.5 returned as "12.50"', async () => {
    const seed = await seedBase()
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        customerId: seed.customerId,
        lines: [{ productId: seed.productId, qty: 1, unitPrice: '12.5' }],
      })
    assert.equal(res.status, 201)
    assert.equal(res.body.order.total, '12.50')
    assert.equal(res.body.order.lines[0]!.unitPrice, '12.50', 'NUMERIC(13,2) canonicalizes on read')
  })

  it('R-ORD-2: precision — unitPrice scale > 2 -> 422', async () => {
    const seed = await seedBase()
    const res = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        customerId: seed.customerId,
        lines: [{ productId: seed.productId, qty: 1, unitPrice: '0.001' }],
      })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-ORD-3: valid flow — draft -> confirm -> confirmed -> cancel -> cancelled', async () => {
    const seed = await seedBase()
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    assert.equal(created.body.order.state, 'draft')

    const confirmed = await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(confirmed.status, 200)
    assert.equal(confirmed.body.order.state, 'confirmed')

    const cancelled = await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/cancel`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ reason: 'customer changed their mind' })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.order.state, 'cancelled')
  })

  it('R-ORD-3: confirmed -> confirm again -> 409 INVALID_STATE', async () => {
    const seed = await seedBase()
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    const again = await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'INVALID_STATE')
  })

  it('R-ORD-3: cancelled -> confirm -> 409 INVALID_STATE', async () => {
    const seed = await seedBase()
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/cancel`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ reason: 'customer changed their mind' })
    const confirm = await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(confirm.status, 409)
    assert.equal(confirm.body.error.code, 'INVALID_STATE')
  })

  it('R-ORD-3: cancel with reason shorter than 10 chars -> 422', async () => {
    const seed = await seedBase()
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    const res = await request(ctx.app)
      .post(`/api/orders/${created.body.order.id}/cancel`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ reason: 'x' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-ORD-4: replay with the same Idempotency-Key -> 200 with the SAME order id, 1 row total', async () => {
    const seed = await seedBase()
    const body = orderBody(seed)
    const first = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'create-key-1')
      .send(body)
    assert.equal(first.status, 201)
    const orderId = first.body.order.id as string

    const replay = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'create-key-1')
      .send(body)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.order.id, orderId, 'replay must return the existing order')

    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE idempotency_key = 'create-key-1'`)
    assert.equal(rows[0]!.n, 1, 'exactly one order row per idempotency key')
  })

  it('R-ORD-4: different keys -> two orders', async () => {
    const seed = await seedBase()
    const body = orderBody(seed)
    const first = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'k1')
      .send(body)
    const second = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'k2')
      .send(body)
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.notEqual(first.body.order.id, second.body.order.id)
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM orders`)
    assert.equal(rows[0]!.n, 2)
  })

  it('R-ORD-7: list with ?status=confirmed returns only confirmed orders', async () => {
    const seed = await seedBase()
    const a = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed, { lines: [{ productId: seed.productId, qty: 1, unitPrice: '1.00' }] }))
    const b = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed, { lines: [{ productId: seed.productId, qty: 2, unitPrice: '1.00' }] }))
    const c = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed, { lines: [{ productId: seed.productId, qty: 3, unitPrice: '1.00' }] }))
    await request(ctx.app)
      .post(`/api/orders/${a.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    await request(ctx.app)
      .post(`/api/orders/${b.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)

    const res = await request(ctx.app)
      .get('/api/orders?status=confirmed')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.pagination.total, 2)
    const states = res.body.data.map((o: { state: string }) => o.state)
    assert.deepEqual(states, ['confirmed', 'confirmed'])
    assert.ok(!res.body.data.some((o: { id: string }) => o.id === c.body.order.id))
  })

  it('R-ORD-7: list filtered by customerId', async () => {
    const seed = await seedBase()
    const otherCustomer = await request(ctx.app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ name: 'Other Customer', email: 'other@test.local' })
    await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: otherCustomer.body.customer.id, lines: [{ productId: seed.productId, qty: 1, unitPrice: '1.00' }] })

    const res = await request(ctx.app)
      .get(`/api/orders?customerId=${otherCustomer.body.customer.id}`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.pagination.total, 1)
  })

  it('R-ORD-7: detail returns the order with lines, product info and string total; unknown id -> 404', async () => {
    const seed = await seedBase()
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))

    const res = await request(ctx.app)
      .get(`/api/orders/${created.body.order.id}`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.order.id, created.body.order.id)
    assert.equal(res.body.order.total, '0.30')
    assert.equal(res.body.order.lines.length, 1)
    assert.equal(res.body.order.lines[0]!.productId, seed.productId)
    assert.equal(res.body.order.lines[0]!.productSku, 'WIDGET-1')
    assert.equal(res.body.order.lines[0]!.qty, 3)

    const missing = await request(ctx.app)
      .get('/api/orders/999999')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'NOT_FOUND')
  })

  it('R-ORD-7: detail loads order + lines in ≤2 queries (spy, no N+1)', async () => {
    const seed = await seedBase()
    const product2 = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Gadget', sku: 'GADGET-2' })
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        customerId: seed.customerId,
        lines: [
          { productId: seed.productId, qty: 1, unitPrice: '1.00' },
          { productId: product2.body.product.id as string, qty: 2, unitPrice: '2.00' },
          { productId: seed.productId, qty: 3, unitPrice: '3.00' },
          { productId: product2.body.product.id as string, qty: 4, unitPrice: '4.00' },
          { productId: seed.productId, qty: 5, unitPrice: '5.00' },
        ],
      })
    assert.equal(created.status, 201)

    const queries: string[] = []
    const original = pool.query.bind(pool)
    pool.query = ((text: string, values?: unknown[]) => {
      queries.push(String(text))
      return original(text, values)
    }) as typeof pool.query

    const res = await request(ctx.app)
      .get(`/api/orders/${created.body.order.id}`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.order.lines.length, 5)
    const orderQueries = queries.filter((q) => /FROM orders|FROM order_items/i.test(q))
    assert.ok(
      orderQueries.length <= 2,
      `expected ≤2 orders/order_items queries, got ${orderQueries.length}: ${orderQueries.join(' | ')}`,
    )
  })

  it('R-ORD-7: viewer can read orders (order_read) but not create (403)', async () => {
    const seed = await seedBase()
    const viewer = await viewerToken()
    const created = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(orderBody(seed))
    const read = await request(ctx.app)
      .get(`/api/orders/${created.body.order.id}`)
      .set('Authorization', `Bearer ${viewer}`)
    assert.equal(read.status, 200)
    const denied = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${viewer}`)
      .send(orderBody(seed))
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error.code, 'FORBIDDEN')
  })
})