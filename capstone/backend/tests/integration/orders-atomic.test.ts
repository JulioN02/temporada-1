import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'

/**
 * it4 ATOMIC SHOWPIECE (T-4-6, T-4-7): order-confirm composition (§3.1,
 * design §7) — lock order → lock products ASC + sufficiency → order_out
 * movements → update confirmed + key → audit → emitEvent. R-ORD-5: commit-all
 * or rollback-all; R-ORD-6: cancel never reverses stock.
 */

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

interface AtomicSeed {
  managerToken: string
  operatorToken: string
  customerId: string
  productId: string
  warehouseId: string
  threshold: number
}

/** Customer (operator) + product/warehouse (manager) + stock level via API. */
async function seedAtomic(initialStock = 10): Promise<AtomicSeed> {
  await createUser(pool, { username: 'atmgr', email: 'atmgr@test.local', password: 'Manager1', role: 'manager' })
  await createUser(pool, { username: 'atop', email: 'atop@test.local', password: 'Operator1', role: 'operator' })
  const managerToken = await loginAndGetToken(ctx.app, 'atmgr', 'Manager1')
  const operatorToken = await loginAndGetToken(ctx.app, 'atop', 'Operator1')

  const customer = await request(ctx.app)
    .post('/api/customers')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ name: 'Atomic Customer', email: 'atomic@test.local' })
  assert.equal(customer.status, 201)
  const product = await request(ctx.app)
    .post('/api/products')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ name: 'Atomic Widget', sku: 'ATOMIC-1', lowStockThreshold: 5 })
  assert.equal(product.status, 201)
  const warehouse = await request(ctx.app)
    .post('/api/warehouses')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ name: 'Atomic WH' })
  assert.equal(warehouse.status, 201)

  const seed: AtomicSeed = {
    managerToken,
    operatorToken,
    customerId: customer.body.customer.id as string,
    productId: product.body.product.id as string,
    warehouseId: warehouse.body.warehouse.id as string,
    threshold: 5,
  }
  if (initialStock > 0) {
    const adjust = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        type: 'adjustment',
        productId: seed.productId,
        warehouseId: seed.warehouseId,
        quantity: initialStock,
        reason: 'atomic seed stock',
      })
    assert.equal(adjust.status, 201)
  }
  return seed
}

async function createOrder(seed: AtomicSeed, qty = 3, productId?: string): Promise<string> {
  const res = await request(ctx.app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${seed.operatorToken}`)
    .send({
      customerId: seed.customerId,
      lines: [{ productId: productId ?? seed.productId, qty, unitPrice: '1.00' }],
    })
  assert.equal(res.status, 201)
  return res.body.order.id as string
}

async function confirm(seed: AtomicSeed, orderId: string, key?: string): Promise<request.Response> {
  const req = request(ctx.app).post(`/api/orders/${orderId}/confirm`).set('Authorization', `Bearer ${seed.operatorToken}`)
  if (key) req.set('Idempotency-Key', key)
  return req
}

/**
 * Side-effect counters for the confirm composition: order_out movements,
 * notification rows and order.confirm audit rows (seed adjustments are
 * excluded — they are setup, not side effects of confirm).
 */
async function counts(): Promise<{ movements: number; notifications: number; audit: number }> {
  const m = await pool.query(`SELECT COUNT(*)::int AS n FROM movements WHERE type = 'order_out'`)
  const n = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications`)
  const a = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'order.confirm'`)
  return { movements: m.rows[0]!.n, notifications: n.rows[0]!.n, audit: a.rows[0]!.n }
}

async function levelOf(seed: AtomicSeed, productId: string, warehouseId: string): Promise<string> {
  const res = await request(ctx.app)
    .get(`/api/stock?productId=${productId}&warehouseId=${warehouseId}`)
    .set('Authorization', `Bearer ${seed.managerToken}`)
  assert.equal(res.status, 200)
  const row = res.body.items.find(
    (r: { product_id: string; warehouse_id: string }) =>
      r.product_id === productId && r.warehouse_id === warehouseId,
  )
  return (row?.level as string) ?? '0'
}

describe('atomic order-confirm composition (T-4-6, T-4-7, R-ORD-5, R-ORD-6)', () => {
  it('R-ORD-5: happy path — confirm writes movements, audit and notification rows atomically', async () => {
    const seed = await seedAtomic(10)
    const orderId = await createOrder(seed, 3)
    const res = await confirm(seed, orderId, 'confirm-k-1')
    assert.equal(res.status, 200)
    assert.equal(res.body.order.state, 'confirmed')

    const { movements, notifications, audit } = await counts()
    assert.equal(movements, 1, 'exactly one order_out movement')
    assert.equal(notifications, 2, 'order_confirmed rows for the creator: in_app + email (it5, R-NOT-2)')
    assert.equal(audit, 1, 'one order.confirm audit row')

    const mov = await pool.query(
      `SELECT type, sign, quantity, reason, idempotency_key FROM movements WHERE type = 'order_out'`,
    )
    assert.equal(mov.rows[0]!.type, 'order_out')
    assert.equal(mov.rows[0]!.sign, -1)
    assert.equal(mov.rows[0]!.quantity, 3)
    assert.equal(mov.rows[0]!.reason, `order ${orderId} confirmed`)
    assert.equal(mov.rows[0]!.idempotency_key, `order_out:${orderId}:${seed.productId}`)

    const notif = await pool.query(
      `SELECT id, type, channel, reference, user_id FROM notifications ORDER BY channel`,
    )
    assert.equal(notif.rows.length, 2)
    assert.deepEqual(
      notif.rows.map((r: { channel: string }) => r.channel).sort(),
      ['email', 'in_app'],
    )
    assert.equal(notif.rows[0]!.type, 'order_confirmed')
    assert.equal(notif.rows[0]!.reference, `order:${orderId}`)

    // S4 (it5): the email row enqueued a pg-boss job IN THE SAME TX — the
    // R-ORD-5 "email job enqueued" assertion completes here.
    const emailRow = notif.rows.find((r: { channel: string }) => r.channel === 'email')!
    const { rows: jobs } = await pool.query(
      `SELECT id, name, data FROM pgboss.job WHERE name = 'notification.send' AND data->>'notificationId' = $1`,
      [String(emailRow.id)],
    )
    assert.equal(jobs.length, 1, 'email job enqueued atomically (S4)')
    const { rows: jobAudits } = await pool.query(
      `SELECT action, entity_id FROM audit_log WHERE action = 'job.created'`,
    )
    assert.equal(jobAudits.length, 1, 'job.created lifecycle audit (R-JOB-5)')
    assert.equal(jobAudits[0]!.entity_id, jobs[0]!.id)

    const auditRow = await pool.query(
      `SELECT action, entity, entity_id, payload FROM audit_log WHERE action = 'order.confirm'`,
    )
    assert.equal(auditRow.rows[0]!.entity, 'order')
    assert.equal(auditRow.rows[0]!.entity_id, orderId)
    assert.equal(auditRow.rows[0]!.payload.lines, 1)
    assert.equal(auditRow.rows[0]!.payload.movementIds.length, 1)

    assert.equal(await levelOf(seed, seed.productId, seed.warehouseId), '7', '10 - 3 = 7')
  })

  it('R-ORD-5: insufficient stock -> 409 INSUFFICIENT_STOCK with ZERO side effects', async () => {
    const seed = await seedAtomic(2)
    const orderId = await createOrder(seed, 3)
    const res = await confirm(seed, orderId, 'confirm-k-2')
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK')

    const { movements, notifications, audit } = await counts()
    assert.equal(movements, 0, 'zero movements (only the seed adjustment row is excluded — none here)')
    assert.equal(notifications, 0, 'zero notifications')
    assert.equal(audit, 0, 'zero audit rows')

    const order = await pool.query(`SELECT state, confirm_idempotency_key FROM orders WHERE id = $1`, [orderId])
    assert.equal(order.rows[0]!.state, 'draft', 'order stays draft')
    assert.equal(order.rows[0]!.confirm_idempotency_key, null)
  })

  it('R-ORD-5: partial sufficiency — line1 ok, line2 insufficient -> 409, NO movement for line1 (all-or-nothing)', async () => {
    const seed = await seedAtomic(5)
    const product2 = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Atomic Gadget', sku: 'ATOMIC-2', lowStockThreshold: 5 })
    assert.equal(product2.status, 201)
    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        customerId: seed.customerId,
        lines: [
          { productId: seed.productId, qty: 1, unitPrice: '1.00' },
          { productId: product2.body.product.id as string, qty: 9, unitPrice: '1.00' },
        ],
      })
    assert.equal(order.status, 201)
    const res = await confirm(seed, order.body.order.id as string, 'confirm-k-3')
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK')
    const { movements, notifications, audit } = await counts()
    assert.equal(movements, 0, 'NO movement for line1 either')
    assert.equal(notifications, 0)
    assert.equal(audit, 0)
  })

  it('R-ORD-5: movement insert failure -> 500 INTERNAL_ERROR and full rollback (order stays draft)', async () => {
    const seed = await seedAtomic(10)
    const orderId = await createOrder(seed, 3)

    // The composition runs on a transaction CLIENT, so the spy must wrap
    // pool.connect's clients. IMPORTANT: pg-pool's Pool.query calls
    // pool.connect(callback) AND then client.query(text, values, callback) —
    // the wrapper must preserve both signatures (promise + callback) or
    // queries hang.
    const originalConnect = pool.connect.bind(pool)
    let injected = false

    function wrapClient(client: import('pg').PoolClient): import('pg').PoolClient {
      const originalClientQuery = client.query.bind(client)
      const callOriginal = originalClientQuery as unknown as (...args: unknown[]) => unknown
      client.query = ((text: unknown, values?: unknown, callback?: unknown) => {
        if (!injected && typeof text === 'string' && /INSERT INTO movements/i.test(text)) {
          injected = true
          const err = new Error('injected movement insert failure')
          if (typeof callback === 'function') {
            ;(callback as (e: Error) => void)(err)
            return client
          }
          return Promise.reject(err)
        }
        return callOriginal(text, values, callback)
      }) as typeof client.query
      return client
    }

    const wrappedConnect = ((callback?: unknown) => {
      if (typeof callback === 'function') {
        const cb = callback as (
          err: Error | null,
          client?: import('pg').PoolClient,
          done?: () => void,
        ) => void
        return originalConnect((err, client, done) => {
          if (err || !client) return cb(err ?? null)
          cb(null, wrapClient(client), done)
        })
      }
      return originalConnect().then((client) => wrapClient(client))
    }) as typeof pool.connect

    pool.connect = wrappedConnect
    try {
      const res = await confirm(seed, orderId, 'confirm-k-4')
      assert.equal(res.status, 500)
      assert.equal(res.body.error.code, 'INTERNAL_ERROR')
    } finally {
      pool.connect = originalConnect
    }
    assert.ok(injected, 'the spy must have intercepted a movement insert')

    const order = await pool.query(`SELECT state FROM orders WHERE id = $1`, [orderId])
    assert.equal(order.rows[0]!.state, 'draft', 'rollback verified — order stays draft')
    const { movements, notifications, audit } = await counts()
    assert.equal(movements, 0)
    assert.equal(notifications, 0)
    assert.equal(audit, 0)
  })

  it('R-ORD-5: idempotent replay — same key -> 200 original, no new movements; different key -> 409 INVALID_STATE', async () => {
    const seed = await seedAtomic(10)
    const orderId = await createOrder(seed, 3)
    const first = await confirm(seed, orderId, 'confirm-k-5')
    assert.equal(first.status, 200)

    const replay = await confirm(seed, orderId, 'confirm-k-5')
    assert.equal(replay.status, 200)
    assert.equal(replay.body.order.id, orderId)
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM movements WHERE type = 'order_out'`,
    )
    assert.equal(rows[0]!.n, 1, 'no duplicate movements on replay')

    const otherKey = await confirm(seed, orderId, 'confirm-k-6')
    assert.equal(otherKey.status, 409)
    assert.equal(otherKey.body.error.code, 'INVALID_STATE')
  })

  it('R-ORD-5: confirm without a key on an already-confirmed order -> 409 INVALID_STATE', async () => {
    const seed = await seedAtomic(10)
    const orderId = await createOrder(seed, 3)
    assert.equal((await confirm(seed, orderId, 'confirm-k-7')).status, 200)
    const res = await confirm(seed, orderId)
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'INVALID_STATE')
  })

  it('R-STK-7: order_out crossing the threshold also fires low_stock (6 -> 4)', async () => {
    const seed = await seedAtomic(6)
    const orderId = await createOrder(seed, 2)
    const res = await confirm(seed, orderId, 'confirm-k-8')
    assert.equal(res.status, 200)
    // The order_out movement row — the choke reference must point at it.
    const orderOut = await pool.query(
      `SELECT id FROM movements WHERE type = 'order_out' AND product_id = $1`,
      [seed.productId],
    )
    const movementId = String(orderOut.rows[0]!.id)
    const { rows } = await pool.query(
      `SELECT n.type, n.reference, u.username FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE n.type = 'low_stock' AND n.channel = 'in_app' ORDER BY u.username`,
    )
    assert.equal(rows.length, 2, 'manager + operator low_stock in-app rows')
    assert.deepEqual(
      rows.map((r: { username: string }) => r.username),
      ['atmgr', 'atop'],
    )
    assert.equal(rows[0]!.reference, `low_stock:${movementId}`, 'reference = low_stock:{movementId}')
    // it5: low_stock also reaches the email channel (R-NOT-2) — same recipients.
    const { rows: emailRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'low_stock' AND channel = 'email'`,
    )
    assert.equal(emailRows[0]!.n, 2, 'email rows for manager + operator')
  })

  it('R-ORD-6: cancel does NOT reverse stock — movements table unchanged, audit row written with reason', async () => {
    const seed = await seedAtomic(10)
    const orderId = await createOrder(seed, 3)
    assert.equal((await confirm(seed, orderId, 'confirm-k-9')).status, 200)
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)

    const cancel = await request(ctx.app)
      .post(`/api/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ reason: 'customer changed their mind' })
    assert.equal(cancel.status, 200)
    assert.equal(cancel.body.order.state, 'cancelled')

    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'no reversal movements on cancel')
    assert.equal(await levelOf(seed, seed.productId, seed.warehouseId), '7', 'stock unchanged by cancel')

    const auditRow = await pool.query(
      `SELECT action, entity_id, payload FROM audit_log WHERE action = 'order.cancel'`,
    )
    assert.equal(auditRow.rows.length, 1)
    assert.equal(auditRow.rows[0]!.entity_id, orderId)
    assert.equal(auditRow.rows[0]!.payload.reason, 'customer changed their mind')
  })

  it('R-ORD-6: cancelled order cannot be confirmed (status machine intact)', async () => {
    const seed = await seedAtomic(10)
    const orderId = await createOrder(seed, 3)
    await request(ctx.app)
      .post(`/api/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ reason: 'customer changed their mind' })
    const res = await confirm(seed, orderId, 'confirm-k-10')
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'INVALID_STATE')
  })
})