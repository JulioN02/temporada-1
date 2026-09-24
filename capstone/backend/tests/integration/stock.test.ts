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

async function managerToken(): Promise<string> {
  await createUser(pool, { username: 'mgr', email: 'mgr@test.local', password: 'Manager1', role: 'manager' })
  return loginAndGetToken(ctx.app, 'mgr', 'Manager1')
}

async function operatorToken(): Promise<string> {
  await createUser(pool, { username: 'op', email: 'op@test.local', password: 'Operator1', role: 'operator' })
  return loginAndGetToken(ctx.app, 'op', 'Operator1')
}

describe('stock catalog integration (T-3-6, R-STK-8 products/warehouses)', () => {
  it('R-STK-8: manager creates a product -> 201 with default threshold', async () => {
    const token = await managerToken()
    const res = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WIDGET-1', lowStockThreshold: 5 })
    assert.equal(res.status, 201)
    assert.equal(res.body.product.name, 'Widget')
    assert.equal(res.body.product.sku, 'WIDGET-1')
    assert.equal(res.body.product.lowStockThreshold, 5)
    assert.equal(res.body.product.active, true)
    assert.equal(typeof res.body.product.id, 'string')
  })

  it('R-STK-8: duplicate sku -> 409 DUPLICATE_SKU', async () => {
    const token = await managerToken()
    await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WIDGET-1' })
    const dup = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget Two', sku: 'WIDGET-1' })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'DUPLICATE_SKU')
  })

  it('R-STK-8: GET /api/products lists products (q filter + pagination)', async () => {
    const token = await managerToken()
    await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WIDGET-1' })
    await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gadget', sku: 'GADGET-1' })

    const all = await request(ctx.app).get('/api/products').set('Authorization', `Bearer ${token}`)
    assert.equal(all.status, 200)
    assert.equal(all.body.pagination.total, 2)

    const filtered = await request(ctx.app)
      .get('/api/products?q=widget')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(filtered.body.pagination.total, 1)
    assert.equal(filtered.body.data[0]!.sku, 'WIDGET-1')
  })

  it('R-STK-8: manager creates a warehouse -> 201', async () => {
    const token = await managerToken()
    const res = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Warehouse' })
    assert.equal(res.status, 201)
    assert.equal(res.body.warehouse.name, 'Main Warehouse')
    assert.equal(typeof res.body.warehouse.id, 'string')
  })

  it('R-STK-8: operator has NO product_manage -> 403 on products', async () => {
    const token = await operatorToken()
    const res = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WIDGET-1' })
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'FORBIDDEN')
  })
})

/**
 * it4 ledger + atomic stock integration (T-4-1..T-4-5, T-4-7): movements
 * ledger (R-STK-1/2), adjustments (R-STK-3), transfers (R-STK-4), idempotency
 * (R-STK-6), low-stock choke (R-STK-7), history reads (R-STK-8).
 */

interface StockSeed {
  managerToken: string
  operatorToken: string
  viewerToken: string
  productId: string
  warehouseId: string
  threshold: number
}

/** Manager creates product + warehouse; operator + viewer tokens for perms. */
async function seedStock(): Promise<StockSeed> {
  const manager = await managerToken()
  const operator = await operatorToken()
  await createUser(pool, { username: 'viewst', email: 'viewst@test.local', password: 'Viewer123', role: 'viewer' })
  const viewerTokenVal = await loginAndGetToken(ctx.app, 'viewst', 'Viewer123')
  const product = await request(ctx.app)
    .post('/api/products')
    .set('Authorization', `Bearer ${manager}`)
    .send({ name: 'Ledger Widget', sku: 'LEDGER-1', lowStockThreshold: 5 })
  assert.equal(product.status, 201)
  const warehouse = await request(ctx.app)
    .post('/api/warehouses')
    .set('Authorization', `Bearer ${manager}`)
    .send({ name: 'Ledger WH' })
  assert.equal(warehouse.status, 201)
  return {
    managerToken: manager,
    operatorToken: operator,
    viewerToken: viewerTokenVal,
    productId: product.body.product.id as string,
    warehouseId: warehouse.body.warehouse.id as string,
    threshold: 5,
  }
}

function adjustmentBody(seed: StockSeed, overrides: Record<string, unknown> = {}) {
  return {
    type: 'adjustment',
    productId: seed.productId,
    warehouseId: seed.warehouseId,
    quantity: 10,
    reason: 'initial stock',
    ...overrides,
  }
}

async function movementCount(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)
  return rows[0]!.n
}

async function notificationCount(type: string, channel?: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE type = $1 AND channel = $2`,
    [type, channel ?? 'in_app'],
  )
  return rows[0]!.n
}

/** GET /api/stock level for one product×warehouse (string, zero-filled). */
async function levelAt(seed: StockSeed, productId: string, warehouseId: string): Promise<string | null> {
  const res = await request(ctx.app)
    .get(`/api/stock?productId=${productId}&warehouseId=${warehouseId}`)
    .set('Authorization', `Bearer ${seed.managerToken}`)
  assert.equal(res.status, 200)
  const row = res.body.items.find(
    (r: { product_id: string; warehouse_id: string }) =>
      r.product_id === productId && r.warehouse_id === warehouseId,
  )
  return row ? (row.level as string) : null
}

describe('stock ledger integration (T-4-1..T-4-5, R-STK-1..8)', () => {
  it('R-STK-1: movement rows are immutable — UPDATE and DELETE blocked by the trigger', async () => {
    const seed = await seedStock()
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed))
    const { rows } = await pool.query(`SELECT id FROM movements`)
    const movementId = rows[0]!.id
    await assert.rejects(
      pool.query(`UPDATE movements SET quantity = 999 WHERE id = $1`, [movementId]),
      /append-only|UPDATE/,
    )
    await assert.rejects(
      pool.query(`DELETE FROM movements WHERE id = $1`, [movementId]),
      /append-only|DELETE/,
    )
    const still = await pool.query(`SELECT COUNT(*)::int AS n FROM movements`)
    assert.equal(still.rows[0]!.n, 1, 'the row must survive both failed mutations')
  })

  it('R-STK-2: stock levels are derived from the view — adjustment +3 reflects immediately', async () => {
    const seed = await seedStock()
    const res = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 3 }))
    assert.equal(res.status, 201)
    assert.equal(await levelAt(seed, seed.productId, seed.warehouseId), '3')
  })

  it('R-STK-2: cross-warehouse — view shows per-warehouse levels', async () => {
    const seed = await seedStock()
    const wh2 = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Ledger WH 2' })
    const wh2Id = wh2.body.warehouse.id as string
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 10 }))
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { warehouseId: wh2Id, quantity: 5 }))
    assert.equal(await levelAt(seed, seed.productId, seed.warehouseId), '10')
    assert.equal(await levelAt(seed, seed.productId, wh2Id), '5')
  })

  it('R-STK-3: adjust up -> 201 and level becomes 15', async () => {
    const seed = await seedStock()
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 10 }))
    const res = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 5, reason: 'extra stock received' }))
    assert.equal(res.status, 201)
    assert.equal(res.body.movement.sign, 1)
    assert.equal(await levelAt(seed, seed.productId, seed.warehouseId), '15')
  })

  it('R-STK-3: adjust below zero -> 409 NEGATIVE_STOCK and the level is unchanged', async () => {
    const seed = await seedStock()
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 3 }))
    const res = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: -5, reason: 'stock correction down' }))
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'NEGATIVE_STOCK')
    assert.equal(await levelAt(seed, seed.productId, seed.warehouseId), '3', 'level must stay 3')
    assert.equal(await movementCount(), 1, 'no ledger row survives the failed adjustment')
  })

  it('R-STK-3: missing/short reason -> 422', async () => {
    const seed = await seedStock()
    const res = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { reason: 'x' }))
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-STK-4: transfer A=10 -> B=0 with qty 4 yields A=6, B=4 and exactly 2 rows', async () => {
    const seed = await seedStock()
    const wh2 = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Ledger WH 2' })
    const wh2Id = wh2.body.warehouse.id as string
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 10 }))
    const res = await request(ctx.app)
      .post('/api/stock/transfers')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({
        productId: seed.productId,
        fromWarehouseId: seed.warehouseId,
        toWarehouseId: wh2Id,
        quantity: 4,
        reason: 'rebalance between warehouses',
      })
    assert.equal(res.status, 201)
    assert.equal(await levelAt(seed, seed.productId, seed.warehouseId), '6')
    assert.equal(await levelAt(seed, seed.productId, wh2Id), '4')
    assert.equal(await movementCount(), 3, 'seed + transfer_out + transfer_in')
  })

  it('R-STK-4: same warehouse -> 422', async () => {
    const seed = await seedStock()
    const res = await request(ctx.app)
      .post('/api/stock/transfers')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({
        productId: seed.productId,
        fromWarehouseId: seed.warehouseId,
        toWarehouseId: seed.warehouseId,
        quantity: 4,
        reason: 'rebalance between warehouses',
      })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-STK-4: insufficient source -> 409, no rows', async () => {
    const seed = await seedStock()
    const wh2 = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Ledger WH 2' })
    const wh2Id = wh2.body.warehouse.id as string
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 2 }))
    const res = await request(ctx.app)
      .post('/api/stock/transfers')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({
        productId: seed.productId,
        fromWarehouseId: seed.warehouseId,
        toWarehouseId: wh2Id,
        quantity: 5,
        reason: 'rebalance between warehouses',
      })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'NEGATIVE_STOCK')
    assert.equal(await movementCount(), 1, 'no transfer rows survive an insufficient source')
  })

  it('R-STK-6: adjustment idempotency — same key replays 200 with the original row, 1 row total', async () => {
    const seed = await seedStock()
    const first = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'adjust-k-1')
      .send(adjustmentBody(seed, { quantity: 7 }))
    assert.equal(first.status, 201)
    const movementId = first.body.movement.id as string
    const replay = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .set('Idempotency-Key', 'adjust-k-1')
      .send(adjustmentBody(seed, { quantity: 7 }))
    assert.equal(replay.status, 200)
    assert.equal(replay.body.movement.id, movementId)
    assert.equal(await movementCount(), 1)
    assert.equal(await levelAt(seed, seed.productId, seed.warehouseId), '7')
  })

  it('R-STK-7: crossing movement (6 -> 4, threshold 5) creates low_stock rows for manager+operator', async () => {
    const seed = await seedStock()
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 6 }))
    const res = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: -2, reason: 'stock correction down' }))
    assert.equal(res.status, 201)
    assert.equal(await notificationCount('low_stock', 'in_app'), 2, 'manager + operator in-app rows (ADR-4)')
    assert.equal(await notificationCount('low_stock', 'email'), 2, 'both channels since it5 (R-NOT-2)')
    const { rows } = await pool.query(
      `SELECT u.username FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE n.type = 'low_stock' AND n.channel = 'in_app' ORDER BY u.username`,
    )
    assert.deepEqual(
      rows.map((r: { username: string }) => r.username),
      ['mgr', 'op'],
    )
  })

  it('R-STK-7: not crossing (8 -> 6 >= threshold) creates no low_stock rows', async () => {
    const seed = await seedStock()
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 8 }))
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: -2, reason: 'stock correction down' }))
    assert.equal(await notificationCount('low_stock', 'in_app'), 0)
    assert.equal(await notificationCount('low_stock', 'email'), 0)
  })

  it('R-STK-7: already low (4 -> 3) fires again — each crossing movement notifies', async () => {
    const seed = await seedStock()
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 4 }))
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: -1, reason: 'stock correction down' }))
    assert.equal(await notificationCount('low_stock', 'in_app'), 2, 'first crossing fires')
    assert.equal(await notificationCount('low_stock', 'email'), 2)
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: -1, reason: 'stock correction down' }))
    assert.equal(await notificationCount('low_stock', 'in_app'), 4, 'second crossing fires again')
    assert.equal(await notificationCount('low_stock', 'email'), 4)
  })

  it('R-STK-8: movement history is newest-first and paginated', async () => {
    const seed = await seedStock()
    for (let i = 0; i < 3; i += 1) {
      const res = await request(ctx.app)
        .post('/api/stock/movements')
        .set('Authorization', `Bearer ${seed.operatorToken}`)
        .send(adjustmentBody(seed, { quantity: 1, reason: `stock increment ${i}` }))
      assert.equal(res.status, 201)
    }
    const all = await request(ctx.app)
      .get('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(all.status, 200)
    assert.equal(all.body.pagination.total, 3)
    const ids = all.body.data.map((m: { id: string }) => m.id)
    assert.deepEqual(ids, [...ids].sort((a, b) => Number(b) - Number(a)), 'newest first (id desc)')

    const page = await request(ctx.app)
      .get('/api/stock/movements?page=2&limit=2')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
    assert.equal(page.status, 200)
    assert.equal(page.body.data.length, 1, '3 movements, limit 2 → page 2 has 1')
    assert.equal(page.body.pagination.totalPages, 2)
  })

  it('R-AUTH-8: viewer cannot adjust (403); operator cannot transfer (403); operator can adjust', async () => {
    const seed = await seedStock()
    const viewerRes = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.viewerToken}`)
      .send(adjustmentBody(seed, { quantity: 1 }))
    assert.equal(viewerRes.status, 403)
    const wh2 = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${seed.managerToken}`)
      .send({ name: 'Ledger WH 2' })
    const transferRes = await request(ctx.app)
      .post('/api/stock/transfers')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send({
        productId: seed.productId,
        fromWarehouseId: seed.warehouseId,
        toWarehouseId: wh2.body.warehouse.id as string,
        quantity: 1,
        reason: 'rebalance between warehouses',
      })
    assert.equal(transferRes.status, 403)
    const ok = await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${seed.operatorToken}`)
      .send(adjustmentBody(seed, { quantity: 1 }))
    assert.equal(ok.status, 201)
  })
})

describe('product PATCH + warehouses CRUD (T-1-5/T-1-6, R-UI-CRM-7/R-UI-CRM-8)', () => {
  it('R-UI-CRM-7: deactivate product -> PATCH {active:false}, row inactive, absent from GET /api/stock', async () => {
    const token = await managerToken()
    const product = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WIDGET-1', lowStockThreshold: 2 })
    assert.equal(product.status, 201)
    const productId = product.body.product.id as string
    const warehouse = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CRM WH' })
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'adjustment',
        productId,
        warehouseId: warehouse.body.warehouse.id as string,
        quantity: 5,
        reason: 'stock for deactivation test',
      })
      .expect(201)

    const before = await request(ctx.app).get('/api/stock').set('Authorization', `Bearer ${token}`)
    assert.equal(before.body.items.length, 1, 'active product appears in stock levels')

    const patch = await request(ctx.app)
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false })
    assert.equal(patch.status, 200)
    assert.equal(patch.body.product.active, false, 'product row now inactive')
    assert.equal(patch.body.product.name, 'Widget', 'unchanged fields preserved')

    const after = await request(ctx.app).get('/api/stock').set('Authorization', `Bearer ${token}`)
    assert.equal(after.body.items.length, 0, 'inactive product absent from stock levels (R-STK-8 join)')

    const list = await request(ctx.app).get('/api/products').set('Authorization', `Bearer ${token}`)
    assert.equal(list.body.data[0]!.active, false, 'products list still shows the deactivated row (no hard delete)')
  })

  it('R-UI-CRM-7: edit name/sku/threshold in one PATCH; duplicate sku -> 409 DUPLICATE_SKU', async () => {
    const token = await managerToken()
    const a = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Alpha', sku: 'ALPHA-1', lowStockThreshold: 1 })
    const b = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Beta', sku: 'BETA-1' })

    const edit = await request(ctx.app)
      .patch(`/api/products/${a.body.product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Alpha Two', sku: 'ALPHA-2', lowStockThreshold: 9 })
    assert.equal(edit.status, 200)
    assert.equal(edit.body.product.name, 'Alpha Two')
    assert.equal(edit.body.product.sku, 'ALPHA-2')
    assert.equal(edit.body.product.lowStockThreshold, 9)

    const dup = await request(ctx.app)
      .patch(`/api/products/${b.body.product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'ALPHA-2' })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'DUPLICATE_SKU')

    const unknown = await request(ctx.app)
      .patch('/api/products/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.error.code, 'NOT_FOUND')

    const empty = await request(ctx.app)
      .patch(`/api/products/${a.body.product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    assert.equal(empty.status, 422, 'at least one field required (refine)')

    const denied = await request(ctx.app)
      .patch(`/api/products/${a.body.product.id}`)
      .set('Authorization', `Bearer ${await operatorToken()}`)
      .send({ name: 'Nope' })
    assert.equal(denied.status, 403, 'operator has no stock:product_manage')
  })

  it('R-UI-CRM-8: warehouses CRUD — GET list, PATCH rename, DELETE 204 (unused)', async () => {
    const token = await managerToken()
    const created = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WH A' })
    assert.equal(created.status, 201)
    const whId = created.body.warehouse.id as string
    await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WH B' })
      .expect(201)

    // GET list (stock:stock_read — operator can read for pickers).
    const operator = await operatorToken()
    const list = await request(ctx.app).get('/api/warehouses').set('Authorization', `Bearer ${operator}`)
    assert.equal(list.status, 200)
    assert.equal(list.body.pagination.total, 2)
    assert.equal((list.body.data as Array<{ name: string }>).map((w) => w.name).sort().join(','), 'WH A,WH B')

    // PATCH rename.
    const patch = await request(ctx.app)
      .patch(`/api/warehouses/${whId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WH A Renamed' })
    assert.equal(patch.status, 200)
    assert.equal(patch.body.warehouse.name, 'WH A Renamed')

    // DELETE unused warehouse -> 204.
    const del = await request(ctx.app)
      .delete(`/api/warehouses/${whId}`)
      .set('Authorization', `Bearer ${token}`)
    assert.equal(del.status, 204)
    const after = await request(ctx.app).get('/api/warehouses').set('Authorization', `Bearer ${operator}`)
    assert.equal(after.body.pagination.total, 1, 'deleted warehouse gone from the list')

    // Unknown id -> 404.
    const unknown = await request(ctx.app)
      .delete('/api/warehouses/999999')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(unknown.status, 404)
  })

  it('R-UI-CRM-8: DELETE a warehouse referenced by movements -> 409 WAREHOUSE_IN_USE (no orphan ledger)', async () => {
    const token = await managerToken()
    const warehouse = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Busy WH' })
    const product = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WIDGET-1' })
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'adjustment',
        productId: product.body.product.id as string,
        warehouseId: warehouse.body.warehouse.id as string,
        quantity: 3,
        reason: 'creates ledger reference',
      })
      .expect(201)

    const del = await request(ctx.app)
      .delete(`/api/warehouses/${warehouse.body.warehouse.id}`)
      .set('Authorization', `Bearer ${token}`)
    assert.equal(del.status, 409)
    assert.equal(del.body.error.code, 'WAREHOUSE_IN_USE', 'additive subcode documented for localizeError')

    const stillThere = await pool.query(`SELECT id FROM warehouses WHERE id = $1`, [warehouse.body.warehouse.id])
    assert.equal(stillThere.rows.length, 1, 'warehouse row survives the blocked delete')

    // Rename to an existing name -> 409 CONFLICT.
    await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second WH' })
      .expect(201)
    const dupName = await request(ctx.app)
      .patch(`/api/warehouses/${warehouse.body.warehouse.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second WH' })
    assert.equal(dupName.status, 409)
    assert.equal(dupName.body.error.code, 'CONFLICT')
  })
})