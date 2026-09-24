import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'
import { emitEvent } from '../../src/modules/notifications/emit.ts'
import { createBossEnqueuer } from '../../src/lib/pgBossTx.ts'
import { NOTIFICATION_TYPES } from '../../src/modules/notifications/types.ts'

/**
 * it5 notifications integration (T-5-6..T-5-10): channel matrix behavior
 * (R-NOT-2), in-app API owner scope (R-NOT-1), email enqueue exactly-once
 * (R-NOT-6), worker-only SMTP (R-NOT-3), delivery state lifecycle (R-NOT-4),
 * no-secrets templates (R-NOT-5). Real Postgres 16 (bop_test) + real pg-boss.
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

interface NotifSeed {
  adminToken: string
  managerToken: string
  operatorToken: string
  customerId: string
  productId: string
  warehouseId: string
}

/** Users (factory) + customer/product/warehouse/stock via API. */
async function seedNotif(): Promise<NotifSeed> {
  await createUser(pool, { username: 'nadmin', email: 'nadmin@test.local', password: 'Admin1', role: 'admin' })
  await createUser(pool, { username: 'nmgr', email: 'nmgr@test.local', password: 'Manager1', role: 'manager' })
  await createUser(pool, { username: 'nop', email: 'nop@test.local', password: 'Operator1', role: 'operator' })
  const adminToken = await loginAndGetToken(ctx.app, 'nadmin', 'Admin1')
  const managerToken = await loginAndGetToken(ctx.app, 'nmgr', 'Manager1')
  const operatorToken = await loginAndGetToken(ctx.app, 'nop', 'Operator1')

  const customer = await request(ctx.app)
    .post('/api/customers')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ name: 'Notif Customer', email: 'notif@test.local' })
  assert.equal(customer.status, 201)
  const product = await request(ctx.app)
    .post('/api/products')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ name: 'Notif Widget', sku: 'NOTIF-1', lowStockThreshold: 5 })
  assert.equal(product.status, 201)
  const warehouse = await request(ctx.app)
    .post('/api/warehouses')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ name: 'Notif WH' })
  assert.equal(warehouse.status, 201)

  return {
    adminToken,
    managerToken,
    operatorToken,
    customerId: customer.body.customer.id as string,
    productId: product.body.product.id as string,
    warehouseId: warehouse.body.warehouse.id as string,
  }
}

async function stock(seed: NotifSeed, qty: number): Promise<void> {
  const res = await request(ctx.app)
    .post('/api/stock/movements')
    .set('Authorization', `Bearer ${seed.operatorToken}`)
    .send({
      type: 'adjustment',
      productId: seed.productId,
      warehouseId: seed.warehouseId,
      quantity: qty,
      reason: 'notif seed stock',
    })
  assert.equal(res.status, 201)
}

async function rowsByType(type: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query(
    `SELECT n.id, n.type, n.channel, n.reference, n.user_id, n.delivery_state, n.title, n.body, u.username
     FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type = $1 ORDER BY n.channel, u.username`,
    [type],
  )
  return rows
}

describe('notifications: in-app API (T-5-7, R-NOT-1)', () => {
  it('R-NOT-1: GET /api/notifications returns ONLY the caller\'s own rows (owner scope), newest first', async () => {
    const seed = await seedNotif()
    await stock(seed, 10)
    // Two orders confirmed by the SAME operator → 2 order_confirmed × 2 channels.
    for (let i = 0; i < 2; i++) {
      const order = await request(ctx.app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${seed.operatorToken}`)
        .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 1, unitPrice: '1.00' }] })
      assert.equal(order.status, 201)
      const confirm = await request(ctx.app)
        .post(`/api/orders/${order.body.order.id}/confirm`)
        .set('Authorization', `Bearer ${seed.operatorToken}`)
        .set('Idempotency-Key', `notif-api-${i}`)
      assert.equal(confirm.status, 200)
    }

    const list = await request(ctx.app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(list.status, 200)
    assert.equal(list.body.data.length, 2, 'operator sees own in_app rows only')
    assert.equal(list.body.pagination.total, 2)
    const first = list.body.data[0] as { id: string; type: string; readAt: string | null; deliveryState: string }
    assert.equal(first.type, 'order_confirmed')
    assert.equal(first.readAt, null, 'fresh rows are unread')
    assert.equal(first.deliveryState, 'pending', 'in_app rows carry pending delivery state')

    // The manager (who did NOT create the orders) sees ZERO rows — owner scope.
    const other = await request(ctx.app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${seed.managerToken}`)
    assert.equal(other.status, 200)
    assert.equal(other.body.data.length, 0, 'other users never see someone else\'s rows')
  })

  it('R-NOT-1: GET /api/notifications/unread-count counts only unread own rows', async () => {
    const seed = await seedNotif()
    await stock(seed, 10)
    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 1, unitPrice: '1.00' }] })
    assert.equal(order.status, 201)
    assert.equal(
      (await request(ctx.app).post(`/api/orders/${order.body.order.id}/confirm`).set('Authorization', `Bearer ${seed.operatorToken}`).set('Idempotency-Key', 'notif-unread-1')).status,
      200,
    )

    const count = await request(ctx.app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(count.status, 200)
    assert.equal(count.body.count, 1)

    // Mark the row read → count drops to 0.
    const { rows } = await pool.query(`SELECT id FROM notifications WHERE channel = 'in_app'`)
    const read = await request(ctx.app)
      .post(`/api/notifications/${rows[0]!.id}/read`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(read.status, 204)
    const after = await request(ctx.app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(after.body.count, 0)
  })

  it('R-NOT-1: mark-read on another user\'s row → 404 (owner scope), idempotent on own rows', async () => {
    const seed = await seedNotif()
    await stock(seed, 10)
    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 1, unitPrice: '1.00' }] })
    assert.equal(order.status, 201)
    assert.equal(
      (await request(ctx.app).post(`/api/orders/${order.body.order.id}/confirm`).set('Authorization', `Bearer ${seed.operatorToken}`).set('Idempotency-Key', 'notif-scope-1')).status,
      200,
    )

    const { rows } = await pool.query(`SELECT id, user_id FROM notifications WHERE channel = 'in_app'`)
    assert.equal(rows.length, 1)
    const ownerId = String(rows[0]!.user_id)
    const notifId = String(rows[0]!.id)

    // The manager attempts to mark the OPERATOR's row read → 404, row unchanged.
    const foreign = await request(ctx.app)
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${seed.managerToken}`)
    assert.equal(foreign.status, 404)
    assert.equal(foreign.body.error.code, 'NOT_FOUND')
    const stillUnread = await pool.query(`SELECT read_at FROM notifications WHERE id = $1`, [notifId])
    assert.equal(stillUnread.rows[0]!.read_at, null, 'foreign mark-read must not mutate the row')
    const { rows: owners } = await pool.query(`SELECT id FROM users WHERE id = $1`, [ownerId])
    assert.equal(owners.length, 1)

    // Owner marks read → 204; marking again (already read) → 204 idempotent.
    const own = await request(ctx.app)
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(own.status, 204)
    const again = await request(ctx.app)
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(again.status, 204, 'idempotent mark-read')
  })
})

describe('notifications: bilingual emit per recipient locale (T-1-3, R-BE-3)', () => {
  it('R-BE-3: es + en recipients of the SAME event render separately and store their own locale', async () => {
    // Two managers, one es (default) and one en (explicit) — same role target.
    await createUser(pool, { username: 'rbe3-es', email: 'rbe3-es@test.local', password: 'Admin1', role: 'manager' })
    await createUser(pool, { username: 'rbe3-en', email: 'rbe3-en@test.local', password: 'Admin1', role: 'manager' })
    await pool.query(`UPDATE users SET locale = 'en' WHERE username = 'rbe3-en'`)

    // low_stock emits for active manager+operator roles — trigger via stock API.
    const seed = await seedNotif()
    await stock(seed, 10)
    const adjust = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        type: 'adjustment',
        productId: seed.productId,
        warehouseId: seed.warehouseId,
        quantity: -8,
        reason: 'drive below threshold',
      })
    assert.equal(adjust.status, 201)

    const { rows } = await pool.query<{
      username: string
      title: string
      body: string
      locale: string
    }>(
      `SELECT u.username, n.title, n.body, n.locale
       FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE n.type = 'low_stock' AND n.channel = 'in_app' ORDER BY u.username`,
    )
    assert.equal(rows.length, 4, 'one in_app row per active manager/operator recipient')
    const es = rows.find((r) => r.username === 'rbe3-es')
    const en = rows.find((r) => r.username === 'rbe3-en')
    assert.ok(es && en, 'both recipients present')

    assert.equal(es!.locale, 'es', 'es recipient stores locale es')
    assert.equal(es!.title, 'Stock bajo')
    assert.ok(es!.body.includes('tiene stock bajo'), 'es recipient body is neutral Spanish')

    assert.equal(en!.locale, 'en', 'en recipient stores locale en')
    assert.equal(en!.title, 'Low stock')
    assert.ok(en!.body.includes('is low'), 'en recipient body is English')

    // The email job still carries ONLY the notificationId (worker re-reads the snapshot).
    const { rows: jobs } = await pool.query(
      `SELECT data FROM pgboss.job WHERE name = 'notification.send'`,
    )
    assert.equal(jobs.length, 4, 'one email job per email-channel row (4 recipients)')
    for (const job of jobs) {
      const data = (job.data as { notificationId?: unknown }).notificationId
      assert.ok(typeof data === 'string' && data.length > 0, 'job payload carries only notificationId')
      assert.deepEqual(Object.keys(job.data as Record<string, unknown>), ['notificationId'])
    }
  })

  it('R-BE-3: replaying the same event -> exactly-once, snapshot (title/body/locale) unchanged', async () => {
    await createUser(pool, { username: 'rbe3b-es', email: 'rbe3b-es@test.local', password: 'Admin1', role: 'manager' })
    await createUser(pool, { username: 'rbe3b-en', email: 'rbe3b-en@test.local', password: 'Admin1', role: 'manager' })
    await pool.query(`UPDATE users SET locale = 'en' WHERE username = 'rbe3b-en'`)
    const enqueuer = createBossEnqueuer(pool)

    const input = {
      type: NOTIFICATION_TYPES.lowStock,
      reference: 'low_stock:rbe3-replay',
      payload: { productName: 'Widget', sku: 'W-1', level: '2', threshold: 5 },
    }
    await emitEvent(pool, input, enqueuer)
    const snapshots = async () =>
      pool.query<{ locale: string; title: string; body: string }>(
        `SELECT locale, title, body FROM notifications
         WHERE reference = 'low_stock:rbe3-replay' AND channel = 'in_app' ORDER BY locale`,
      )
    const first = await snapshots()
    assert.equal(first.rows.length, 2, 'one in_app row per recipient on first emit')

    // Replay the same event (same reference) — ON CONFLICT DO NOTHING keeps
    // exactly-once and the rendered snapshot untouched.
    await emitEvent(pool, input, enqueuer)
    const second = await snapshots()
    assert.equal(second.rows.length, 2, 'replay adds no duplicate rows')
    assert.deepEqual(second.rows, first.rows, 'snapshot (locale/title/body) unchanged after replay')

    const { rows: jobs } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = 'notification.send'`,
    )
    assert.equal(jobs[0]!.n, 2, 'replay enqueues no extra email jobs')
  })
})

describe('notifications: channel matrix behavior (T-5-6, R-NOT-2)', () => {
  it('R-NOT-3: the REQUEST path never sends mail — the email row stays pending until a worker delivers it', async () => {
    const seed = await seedNotif()
    const create = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${seed.adminToken}`)
      .send({ username: 'reqinvite', email: 'reqinvite@test.local', password: 'ReqPass12345', role: 'viewer' })
    assert.equal(create.status, 201)

    // No worker is running in this test — the request path's ONLY side effect
    // must be the row + the job. If any code path sent mail, the state would
    // not remain pending (and there is no mailer in the request path at all —
    // tests/contract/mailer-isolation.test.ts proves the imports).
    const { rows } = await pool.query(
      `SELECT delivery_state FROM notifications WHERE type = 'user_invited' AND channel = 'email'`,
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.delivery_state, 'pending', 'request path never sends — delivery is the worker\'s job')

    const { rows: jobs } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = 'notification.send'`,
    )
    assert.equal(jobs[0]!.n, 1, 'the request path enqueues exactly one job (its only side effect)')
  })

  it('R-NOT-2: order_confirmed emits BOTH channels for the order creator, with exactly 1 enqueued job', async () => {
    const seed = await seedNotif()
    await stock(seed, 10)
    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 2, unitPrice: '1.00' }] })
    assert.equal(order.status, 201)
    const orderId = order.body.order.id as string

    const confirm = await request(ctx.app)
      .post(`/api/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'notif-confirm-1')
    assert.equal(confirm.status, 200)

    const rows = await rowsByType('order_confirmed')
    assert.equal(rows.length, 2, 'creator receives in_app + email rows')
    const channels = rows.map((r) => r.channel).sort()
    assert.deepEqual(channels, ['email', 'in_app'])

    const { rows: jobs } = await pool.query(
      `SELECT id, name, data FROM pgboss.job WHERE name = 'notification.send' AND data->>'notificationId' IS NOT NULL`,
    )
    assert.equal(jobs.length, 1, 'exactly one enqueued job for the email row')
    assert.equal((jobs[0]!.data as { notificationId: string }).notificationId, String(rows.find((r) => r.channel === 'email')!.id))

    const { rows: audits } = await pool.query(
      `SELECT action, entity, entity_id, payload FROM audit_log WHERE action = 'job.created'`,
    )
    assert.equal(audits.length, 1, 'job.created lifecycle audit row written in the same tx')
    assert.equal(audits[0]!.entity_id, jobs[0]!.id)
  })

  it('R-NOT-2: user_invited is EMAIL-ONLY (no in_app row) and enqueues one job', async () => {
    const seed = await seedNotif()
    const create = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${seed.adminToken}`)
      .send({ username: 'invitee1', email: 'invitee1@test.local', password: 'InviteePass1', role: 'viewer' })
    assert.equal(create.status, 201)

    const rows = await rowsByType('user_invited')
    assert.equal(rows.length, 1, 'exactly one row (email-only type)')
    assert.equal(rows[0]!.channel, 'email')
    assert.equal(rows[0]!.username, 'invitee1')
    assert.ok(!String(rows[0]!.body).includes('InviteePass1'), 'R-NOT-5: body never contains the password')

    const { rows: jobs } = await pool.query(
      `SELECT id FROM pgboss.job WHERE name = 'notification.send' AND data->>'notificationId' = $1`,
      [String(rows[0]!.id)],
    )
    assert.equal(jobs.length, 1, 'one enqueued job')
  })

  it('R-NOT-6: replaying the same domain event never duplicates rows or jobs (exactly-once)', async () => {
    const seed = await seedNotif()
    await stock(seed, 10)
    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({ customerId: seed.customerId, lines: [{ productId: seed.productId, qty: 2, unitPrice: '1.00' }] })
    assert.equal(order.status, 201)
    const orderId = order.body.order.id as string

    const first = await request(ctx.app)
      .post(`/api/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'notif-replay-1')
    assert.equal(first.status, 200)
    // Idempotent replay (same key) — must NOT emit again.
    const replay = await request(ctx.app)
      .post(`/api/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'notif-replay-1')
    assert.equal(replay.status, 200)

    const rows = await rowsByType('order_confirmed')
    assert.equal(rows.length, 2, 'replay adds no duplicate rows')
    const { rows: jobs } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = 'notification.send'`,
    )
    assert.equal(jobs[0]!.n, 1, 'replay adds no duplicate jobs')
  })
})