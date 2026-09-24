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

/** Operator token (crm write perms per matrix) — fresh user per test. */
async function operatorToken(username = 'op', password = 'Operator1'): Promise<string> {
  await createUser(pool, { username, email: `${username}@test.local`, password, role: 'operator' })
  return loginAndGetToken(ctx.app, username, password)
}

async function viewerToken(): Promise<string> {
  await createUser(pool, { username: 'viewer1', email: 'viewer1@test.local', password: 'Viewer123', role: 'viewer' })
  return loginAndGetToken(ctx.app, 'viewer1', 'Viewer123')
}

let emailSeq = 0
async function createCustomer(token: string, overrides: Record<string, unknown> = {}) {
  emailSeq += 1
  const body = { name: 'Ana Ruiz', email: `c${emailSeq}@test.local`, phone: '555-0100', ...overrides }
  return request(ctx.app).post('/api/customers').set('Authorization', `Bearer ${token}`).send(body)
}

describe('crm integration (T-2-5, R-CRM-1..5)', () => {
  it('R-CRM-1: operator creates a customer -> 201 with status active', async () => {
    const token = await operatorToken()
    const res = await createCustomer(token, { email: 'ana@test.local' })
    assert.equal(res.status, 201)
    assert.equal(res.body.customer.name, 'Ana Ruiz')
    assert.equal(res.body.customer.email, 'ana@test.local')
    assert.equal(res.body.customer.status, 'active')
    assert.equal(typeof res.body.customer.id, 'string')
    assert.equal(typeof res.body.customer.createdAt, 'string')
  })

  it('R-CRM-1: duplicate email -> 409 DUPLICATE_EMAIL', async () => {
    const token = await operatorToken()
    await createCustomer(token, { email: 'dup@test.local' })
    const dup = await createCustomer(token, { name: 'Otra Ana', email: 'dup@test.local' })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'DUPLICATE_EMAIL')
  })

  it('R-CRM-1: invalid email -> 422 VALIDATION_ERROR', async () => {
    const token = await operatorToken()
    const res = await createCustomer(token, { email: 'x' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-AUTH-8: viewer token -> 403 on customer_create (per-request DB check)', async () => {
    const token = await viewerToken()
    const res = await createCustomer(token)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'FORBIDDEN')
  })

  it('R-CRM-2: search q matches name/email case-insensitively (substring)', async () => {
    const token = await operatorToken()
    await createCustomer(token, { name: 'Ana Ruiz', email: 'ana@test.local' })
    await createCustomer(token, { name: 'Luis Paz', email: 'luis@test.local' })
    await createCustomer(token, { name: 'María Ana', email: 'mari@test.local' })

    const byName = await request(ctx.app)
      .get('/api/customers?q=ana')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(byName.status, 200)
    assert.deepEqual(
      byName.body.data.map((c: { name: string }) => c.name).sort(),
      ['Ana Ruiz', 'María Ana'],
    )

    const byEmail = await request(ctx.app)
      .get('/api/customers?q=LUIS')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(byEmail.body.data.length, 1)
    assert.equal(byEmail.body.data[0]!.email, 'luis@test.local')
  })

  it('R-CRM-2: pagination — 25 customers, page 2 limit 10 -> 10 rows, total 25, totalPages 3', async () => {
    const token = await operatorToken()
    for (let i = 0; i < 25; i++) {
      await createCustomer(token, { name: `C${i}`, email: `c${i}@test.local` })
    }
    const res = await request(ctx.app)
      .get('/api/customers?page=2&limit=10')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 10)
    assert.equal(res.body.pagination.page, 2)
    assert.equal(res.body.pagination.limit, 10)
    assert.equal(res.body.pagination.total, 25)
    assert.equal(res.body.pagination.totalPages, 3)
  })

  it('R-CRM-2: status filter — ?status=inactive returns only inactive', async () => {
    const token = await operatorToken()
    await createCustomer(token, { name: 'A' })
    const b = await createCustomer(token, { name: 'B' })
    await request(ctx.app)
      .patch(`/api/customers/${b.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inactive' })

    const res = await request(ctx.app)
      .get('/api/customers?status=inactive')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 1)
    assert.equal(res.body.data[0]!.name, 'B')
    assert.equal(res.body.data[0]!.status, 'inactive')
  })

  it('R-CRM-3: PATCH updates only provided fields -> 200', async () => {
    const token = await operatorToken()
    const created = await createCustomer(token, { email: 'ana@test.local' })
    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '555-9999' })
    assert.equal(res.status, 200)
    assert.equal(res.body.customer.phone, '555-9999')
    assert.equal(res.body.customer.name, 'Ana Ruiz', 'unrelated fields must stay unchanged')
    assert.equal(res.body.customer.email, 'ana@test.local')
  })

  it('R-CRM-3: PATCH unknown id -> 404 NOT_FOUND', async () => {
    const token = await operatorToken()
    const res = await request(ctx.app)
      .patch('/api/customers/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '555-9999' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'NOT_FOUND')
  })

  it('R-CRM-3: PATCH to a duplicate email -> 409 DUPLICATE_EMAIL', async () => {
    const token = await operatorToken()
    await createCustomer(token, { name: 'Ana', email: 'ana@test.local' })
    const other = await createCustomer(token, { name: 'Luis', email: 'luis@test.local' })
    const res = await request(ctx.app)
      .patch(`/api/customers/${other.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'ana@test.local' })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'DUPLICATE_EMAIL')
  })

  it('R-CRM-4: deactivated customer excluded from the default list but retrievable by id', async () => {
    const token = await operatorToken()
    await createCustomer(token, { name: 'Keep' })
    const gone = await createCustomer(token, { name: 'Remove' })
    await request(ctx.app)
      .patch(`/api/customers/${gone.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inactive' })

    const list = await request(ctx.app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    assert.equal(list.status, 200)
    const names = list.body.data.map((c: { name: string }) => c.name)
    assert.ok(names.includes('Keep'), 'active customer must be listed')
    assert.ok(!names.includes('Remove'), 'inactive customer must be excluded from the default list')

    const byId = await request(ctx.app)
      .get(`/api/customers/${gone.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
    assert.equal(byId.status, 200)
    assert.equal(byId.body.customer.status, 'inactive')
  })

  it('R-CRM-4: invalid status -> 422 VALIDATION_ERROR', async () => {
    const token = await operatorToken()
    const created = await createCustomer(token)
    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'frozen' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-CRM-5: create writes a customer.create audit row with the customer id (same-tx)', async () => {
    const token = await operatorToken()
    const res = await createCustomer(token)
    assert.equal(res.status, 201)
    const { rows } = await pool.query(
      `SELECT action, entity, entity_id FROM audit_log WHERE action = 'customer.create'`,
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.entity, 'customer')
    assert.equal(rows[0]!.entity_id, res.body.customer.id)
  })

  it('R-CRM-5: duplicate-email create leaves NO audit row (rollback parity)', async () => {
    const token = await operatorToken()
    await createCustomer(token, { email: 'dup2@test.local' })
    const dup = await createCustomer(token, { name: 'Otra Ana', email: 'dup2@test.local' })
    assert.equal(dup.status, 409)
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'customer.create'`,
    )
    assert.equal(rows[0]!.n, 1, 'only the first (successful) create may have an audit row')
  })

  it('R-CRM-5: update writes a customer.update audit row', async () => {
    const token = await operatorToken()
    const created = await createCustomer(token)
    await request(ctx.app)
      .patch(`/api/customers/${created.body.customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inactive', phone: '1' })
    const { rows } = await pool.query(
      `SELECT payload FROM audit_log WHERE action = 'customer.update' ORDER BY id DESC LIMIT 1`,
    )
    assert.equal(rows.length, 1)
    const payload = rows[0]!.payload as Record<string, unknown>
    assert.equal(payload.status, 'inactive')
  })

  it('R-NFR-1: SQL injection attempt via q is inert — 200 empty results, table intact', async () => {
    const token = await operatorToken()
    await createCustomer(token, { name: 'Ana' })
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM customers`)
    const res = await request(ctx.app)
      .get('/api/customers?q=' + encodeURIComponent(`'; DROP TABLE customers;--`))
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 0, 'injection payload must not match any row')
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM customers`)
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'customers table must be intact')
  })

  it('R-NFR-6: customer list runs ≤2 queries against the customers table (count + data, no N+1)', async () => {
    const token = await operatorToken()
    for (let i = 0; i < 5; i++) {
      await createCustomer(token, { name: `C${i}`, email: `c${i}@test.local` })
    }
    const queries: string[] = []
    const original = pool.query.bind(pool)
    pool.query = ((text: string, values?: unknown[]) => {
      queries.push(String(text))
      return original(text, values)
    }) as typeof pool.query

    const res = await request(ctx.app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 5)
    const customerQueries = queries.filter((q) => /FROM customers/i.test(q))
    assert.ok(
      customerQueries.length <= 2,
      `expected ≤2 customers-table queries, got ${customerQueries.length}: ${customerQueries.join(' | ')}`,
    )
  })
})