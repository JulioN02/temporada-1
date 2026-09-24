// it1 evidence demo (scratch — deleted after evidence generation): exercises
// every NEW endpoint against the real test DB via supertest (same harness as
// the suite). Output captured into docs/output-ui-it1.txt.
import { createApp } from '../src/app.ts'
import { createTestPool, resetDatabase } from '../tests/helpers/db.ts'
import { createBossEnqueuer } from '../src/lib/pgBossTx.ts'
import { createUser, loginAndGetToken } from '../tests/helpers/users.ts'
import { pino } from 'pino'
import request from 'supertest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const pool = createTestPool()
await resetDatabase(pool)
const distDir = mkdtempSync(path.join(tmpdir(), 'ui-dist-evidence-'))
writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>SPA shell (fixture)</title>')
const app = createApp({
  db: pool,
  config: { jwtSecret: 'x'.repeat(40), cookieSecret: 'y'.repeat(40), isProduction: false, appVersion: 'it1-evidence' },
  logger: pino({ level: 'silent' }),
  boss: createBossEnqueuer(pool),
  uiDistDir: distDir,
})

const out: string[] = []
const step = (label: string, res: { status: number }): void => {
  out.push(`  ${label.padEnd(58)} -> ${res.status}`)
}

try {
  await createUser(pool, { username: 'ev-admin', email: 'ev-admin@test.local', password: 'AdminPass123', role: 'admin' })
  const token = await loginAndGetToken(app, 'ev-admin', 'AdminPass123')

  // R-BE-4: PATCH /api/auth/me
  step('PATCH /api/auth/me {locale:en}', await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ locale: 'en' }))
  step('PATCH /api/auth/me {locale:fr} (invalid)', await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ locale: 'fr' }))

  // R-UI-CRM-7: PATCH /api/products/:id
  const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({ name: 'Widget', sku: 'WID-1', lowStockThreshold: 2 })
  step('POST /api/products', product)
  step('PATCH /api/products/:id {lowStockThreshold:5}', await request(app).patch(`/api/products/${product.body.product.id}`).set('Authorization', `Bearer ${token}`).send({ lowStockThreshold: 5 }))

  // R-UI-CRM-8: warehouses CRUD (product still ACTIVE so the movement insert works)
  const wh = await request(app).post('/api/warehouses').set('Authorization', `Bearer ${token}`).send({ name: 'Main WH' })
  step('POST /api/warehouses', wh)
  step('GET /api/warehouses', await request(app).get('/api/warehouses').set('Authorization', `Bearer ${token}`))
  step('PATCH /api/warehouses/:id {name}', await request(app).patch(`/api/warehouses/${wh.body.warehouse.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Main WH 2' }))
  step('DELETE /api/warehouses/:id (unused -> 204)', await request(app).delete(`/api/warehouses/${wh.body.warehouse.id}`).set('Authorization', `Bearer ${token}`))
  const wh2 = await request(app).post('/api/warehouses').set('Authorization', `Bearer ${token}`).send({ name: 'Busy WH' })
  const mv = await request(app).post('/api/stock/movements').set('Authorization', `Bearer ${token}`).send({ type: 'adjustment', productId: product.body.product.id, warehouseId: wh2.body.warehouse.id, quantity: 3, reason: 'creates ledger reference' })
  step('POST /api/stock/movements (ledger ref)', mv)
  step('DELETE in-use warehouse -> 409 WAREHOUSE_IN_USE', await request(app).delete(`/api/warehouses/${wh2.body.warehouse.id}`).set('Authorization', `Bearer ${token}`))

  // R-UI-CRM-7 (cont.): deactivate AFTER the ledger reference was created.
  step('PATCH /api/products/:id {active:false}', await request(app).patch(`/api/products/${product.body.product.id}`).set('Authorization', `Bearer ${token}`).send({ active: false }))

  // R-UI-JOB-1: jobs filters
  for (const [q, s] of [['notification.send', 'completed'], ['notification.send', 'failed'], ['report.queue', 'completed']] as const) {
    await pool.query(`SELECT pgboss.create_queue($1, $2::jsonb)`, [q, JSON.stringify({ policy: 'standard' })])
    await pool.query(
      `INSERT INTO pgboss.job (id, name, data, state, priority, retry_count, retry_limit, retry_delay, retry_backoff, expire_seconds, deletion_seconds, start_after, created_on, keep_until)
       VALUES (gen_random_uuid(), $1, '{}'::jsonb, $2, 0, 0, 1, 0, false, 900, 2592000, now(), now(), now() + interval '30 days')`,
      [q, s],
    )
  }
  const jobsCompleted = await request(app).get('/api/jobs?state=completed').set('Authorization', `Bearer ${token}`)
  step('GET /api/jobs?state=completed', jobsCompleted)
  out.push(`      pagination.total = ${jobsCompleted.body.pagination.total} (COUNT parity)`)
  const jobsQueue = await request(app).get('/api/jobs?queue=report.queue').set('Authorization', `Bearer ${token}`)
  step('GET /api/jobs?queue=report.queue', jobsQueue)

  // R-BE-5: SPA fallback
  step('GET /orders/42 (deep link -> 200 index.html)', await request(app).get('/orders/42'))
  step('GET /api/does-not-exist (JSON 404 preserved)', await request(app).get('/api/does-not-exist'))

  // R-DOC-1: docs regeneration
  const docs = await request(app).get('/api/docs.json')
  step('GET /api/docs.json', docs)
  const paths = Object.keys(docs.body.paths as Record<string, unknown>)
  const newPaths = ['/api/auth/me', '/api/products/{id}', '/api/warehouses/{id}']
  out.push(`      new/updated paths present: ${newPaths.every((p) => paths.includes(p)) ? 'yes' : 'NO'}`)
  out.push(`      user schema documents locale: ${'locale' in (docs.body.components.schemas.User.properties as Record<string, unknown>) ? 'yes' : 'NO'}`)

  console.log(out.join('\n'))
} finally {
  await pool.end()
  rmSync(distDir, { recursive: true, force: true })
}