import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pino } from 'pino'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { createTestPool, resetDatabase } from '../helpers/db.ts'
import { createBossEnqueuer } from '../../src/lib/pgBossTx.ts'
import { createApp } from '../../src/app.ts'
import { adminToken, createUser, loginAndGetToken } from '../helpers/users.ts'

let ctx: TestContext

beforeEach(async () => {
  ctx = createTestContext()
  await resetDatabase(ctx.pool)
})

afterEach(async () => {
  await ctx.pool.end()
})

/**
 * R-PROD-7 (MODIFIED at capstone-ui it2 — vanilla v1 files removed at
 * T-2-1): the appliance serves the React 19 SPA. No browser in the suite:
 * the static assets are asserted directly and the SPA's EXACT data contract
 * (the fetch sequence the React app performs) is exercised end-to-end:
 * login → lists → confirm order → notification appears.
 */
describe('R-PROD-7 React SPA (T-2-1, R-PROD-7 modified)', () => {
  it('R-PROD-7: / serves the SPA shell (Vite index.html, no vanilla login form)', async () => {
    const res = await request(ctx.app).get('/')
    assert.equal(res.status, 200)
    const html = res.text as string
    assert.ok(html.includes('BOP v1'), 'app title present')
    assert.ok(html.includes('id="root"'), 'SPA mount point present')
    // Module entry: the dev source shell references /src/main.tsx; after a
    // local `npm run build -w ui` the static mount serves the built shell
    // (/assets/index-*.js) instead — BOTH prove the SPA shell (no vanilla).
    assert.ok(
      html.includes('/src/main.tsx') || html.includes('/assets/'),
      'module entry referenced (dev source or built assets)',
    )
    assert.ok(!html.includes('id="loginForm"'), 'vanilla login form gone')
    assert.ok(!html.includes('app.js'), 'vanilla script tag gone')
  })

  it('R-PROD-7: /app.js is gone — the SPA fallback serves the shell instead of the vanilla client', async () => {
    // Hermetic fixture dist (no Vite build required): GET /app.js must NOT
    // return the vanilla script — the fallback serves index.html (R-BE-5).
    const pool = createTestPool()
    await resetDatabase(pool)
    const distDir = mkdtempSync(path.join(tmpdir(), 'ui-dist-rprod7-'))
    writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>SPA fixture</title><div id="root"></div>')
    const spaApp = createApp({
      db: pool,
      config: { jwtSecret: 'x'.repeat(40), cookieSecret: 'y'.repeat(40), isProduction: false, appVersion: 'test' },
      logger: pino({ level: 'silent' }),
      boss: createBossEnqueuer(pool),
      uiDistDir: distDir,
    })
    try {
      const res = await request(spaApp).get('/app.js')
      assert.equal(res.status, 200)
      assert.match(res.headers['content-type'] as string, /text\/html/)
      const html = res.text as string
      assert.ok(html.includes('id="root"'), 'SPA shell served')
      assert.ok(!html.includes('state.token'), 'vanilla client signature absent')
    } finally {
      await pool.end()
      rmSync(distDir, { recursive: true, force: true })
    }
  })

  it('R-PROD-7: end-to-end UI flow — login → lists → confirm order → notification appears', async () => {
    const token = await adminToken(ctx.app, ctx.pool)
    // Create the data the SPA renders (same API calls the React app performs).
    const warehouse = await request(ctx.app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main WH' })
    assert.equal(warehouse.status, 201)
    const product = await request(ctx.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Widget', sku: 'WID-1', lowStockThreshold: 2 })
    assert.equal(product.status, 201)
    const productId = product.body.product.id as string
    await request(ctx.app)
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'adjustment',
        productId,
        warehouseId: warehouse.body.warehouse.id,
        quantity: 5,
        reason: 'initial stock',
      })
      .expect(201)
    const customer = await request(ctx.app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ana Ruiz' })
    const order = await request(ctx.app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: customer.body.customer.id, lines: [{ productId, qty: 2, unitPrice: '1.50' }] })
    assert.equal(order.status, 201)
    const orderId = order.body.order.id as string

    // UI read views.
    const customers = await request(ctx.app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    assert.equal(customers.body.data.length, 1)
    const stock = await request(ctx.app).get('/api/stock').set('Authorization', `Bearer ${token}`)
    // NOTE: GET /api/stock returns {items} (Batch C contract — not the
    // {data,pagination} envelope used by list endpoints).
    assert.equal(stock.body.items.length, 1)

    // UI confirm-order flow (atomic path, R-ORD-5).
    const confirm = await request(ctx.app)
      .post(`/api/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    assert.equal(confirm.status, 200)
    assert.equal(confirm.body.order.state, 'confirmed')

    // The confirmation notification appears in the UI list (order creator).
    const notifications = await request(ctx.app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
    assert.ok((notifications.body.data as Array<{ type: string }>).some((n) => n.type === 'order_confirmed'))
  })

  it('R-PROD-7: unauthenticated UI data calls fail with 401 (UI shows the login form)', async () => {
    const res = await request(ctx.app).get('/api/customers')
    assert.equal(res.status, 401)
  })

  it('R-PROD-7: login via the UI contract returns an access token (operator role can read lists)', async () => {
    await createUser(ctx.pool, {
      username: 'op1',
      email: 'op1@test.local',
      password: 'OperatorPass123',
      role: 'operator',
    })
    const token = await loginAndGetToken(ctx.app, 'op1', 'OperatorPass123')
    const res = await request(ctx.app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
  })
})