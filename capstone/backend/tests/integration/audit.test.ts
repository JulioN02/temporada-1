import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createTestPool, resetDatabase } from '../helpers/db.ts'
import type { Pool } from 'pg'
import { withTransaction } from '../../src/db/transaction.ts'
import { writeAudit } from '../../src/modules/audit/write.ts'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { adminToken, createUser, loginAndGetToken } from '../helpers/users.ts'

let pool: Pool

beforeEach(async () => {
  pool = createTestPool()
  await resetDatabase(pool)
})

describe('audit append-only + writeAudit (F-7, S1 early port)', () => {
  it('R-AUD-1: direct UPDATE on audit_log is blocked by the trigger', async () => {
    const { rows } = await pool.query(
      `INSERT INTO audit_log (action, entity, payload) VALUES ('probe', 'user', '{}'::jsonb) RETURNING id`,
    )
    await assert.rejects(
      pool.query(`UPDATE audit_log SET action = 'hacked' WHERE id = $1`, [rows[0]!.id]),
      /append-only|UPDATE/,
    )
  })

  it('R-AUD-1: direct DELETE on audit_log is blocked by the trigger', async () => {
    const { rows } = await pool.query(
      `INSERT INTO audit_log (action, entity, payload) VALUES ('probe', 'user', '{}'::jsonb) RETURNING id`,
    )
    await assert.rejects(
      pool.query(`DELETE FROM audit_log WHERE id = $1`, [rows[0]!.id]),
      /append-only|UPDATE|DELETE/,
    )
    // Row is still there after the failed DELETE.
    const check = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE id = $1`, [rows[0]!.id])
    assert.equal(check.rows[0]!.n, 1)
  })

  it('writeAudit inserts an append-only row with JSON payload', async () => {
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('admin', 'admin@test.local', 'x') RETURNING id`,
    )
    const actorId = userRows[0]!.id as string
    await writeAudit(pool, {
      action: 'user.create',
      entity: 'user',
      entityId: '42',
      actorId,
      actorUsername: 'admin',
      payload: { username: 'pepe', outcome: 'success' },
    })
    const { rows } = await pool.query(
      `SELECT action, entity, entity_id, actor_id, actor_username, payload FROM audit_log`,
    )
    assert.equal(rows.length, 1)
    const row = rows[0]!
    assert.equal(row.action, 'user.create')
    assert.equal(row.entity, 'user')
    assert.equal(row.entity_id, '42')
    assert.equal(row.actor_id, actorId)
    assert.equal(row.actor_username, 'admin')
    assert.deepEqual(row.payload, { username: 'pepe', outcome: 'success' })
  })

  it('R-AUD-2: audit row rolls back with the business transaction (rollback parity, early port)', async () => {
    await assert.rejects(
      withTransaction(pool, async (tx) => {
        await writeAudit(tx, { action: 'order.confirm', entity: 'order', entityId: '7' })
        throw new Error('business tx fails')
      }),
    )
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'order.confirm'`)
    assert.equal(rows[0]!.n, 0)
  })
})

describe('R-AUD-3 no credentials in audit payloads (T-6-2)', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = createTestContext()
    await resetDatabase(ctx.pool)
  })

  afterEach(async () => {
    await ctx.pool.end()
  })

  it('R-AUD-3: login audit payload has actor/outcome/ip only — no password, hash or token material', async () => {
    await createUser(ctx.pool, {
      username: 'op1',
      email: 'op1@test.local',
      password: 'OperatorPass123',
      role: 'operator',
    })
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'op1', password: 'OperatorPass123' })
    assert.equal(res.status, 200)

    const { rows } = await ctx.pool.query(
      `SELECT payload FROM audit_log WHERE action = 'auth.login' ORDER BY created_at DESC LIMIT 1`,
    )
    assert.equal(rows.length, 1)
    const payload = rows[0]!.payload as Record<string, unknown>
    assert.deepEqual(Object.keys(payload).sort(), ['actor', 'ip', 'outcome'])
    assert.equal(payload['outcome'], 'success')
    const serialized = JSON.stringify(payload)
    assert.ok(!serialized.includes('OperatorPass123'), 'password value must never reach the audit payload')
    assert.ok(!serialized.toLowerCase().includes('token'))
    assert.ok(!serialized.toLowerCase().includes('hash'))
  })

  it('R-AUD-3: failed login audit also carries no credential material', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'WrongPass456' })
    assert.equal(res.status, 401)
    const { rows } = await ctx.pool.query(
      `SELECT payload FROM audit_log WHERE action = 'auth.login.failure' ORDER BY created_at DESC LIMIT 1`,
    )
    const payload = rows[0]!.payload as Record<string, unknown>
    const serialized = JSON.stringify(payload)
    assert.ok(!serialized.includes('WrongPass456'))
    assert.ok(!serialized.toLowerCase().includes('token'))
  })
})

describe('R-AUD-4 audit read API (T-6-1)', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = createTestContext()
    await resetDatabase(ctx.pool)
  })

  afterEach(async () => {
    await ctx.pool.end()
  })

  it('R-AUD-4: admin filters audit by entity+action — only matches, newest-first, paginated', async () => {
    const token = await adminToken(ctx.app, ctx.pool)
    // Two customer creates → 2 customer.create rows + 1 auth.login row (adminToken).
    for (const name of ['Ana Ruiz', 'Luis Paz']) {
      const res = await request(ctx.app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name })
      assert.equal(res.status, 201)
    }
    const res = await request(ctx.app)
      .get('/api/audit?entity=customer&action=customer.create')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 2)
    for (const row of res.body.data as Array<{ entity: string; action: string }>) {
      assert.equal(row.entity, 'customer')
      assert.equal(row.action, 'customer.create')
    }
    // Newest-first ordering.
    const createdAts = (res.body.data as Array<{ created_at: string }>).map((r) => r.created_at)
    assert.ok(createdAts[0]! >= createdAts[1]!, 'rows must be newest-first')
    assert.deepEqual(res.body.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 })
  })

  it('R-AUD-4: operator token -> 403 FORBIDDEN (audit:read is admin/auditor only)', async () => {
    await adminToken(ctx.app, ctx.pool)
    await createUser(ctx.pool, {
      username: 'op1',
      email: 'op1@test.local',
      password: 'OperatorPass123',
      role: 'operator',
    })
    const operatorToken = await loginAndGetToken(ctx.app, 'op1', 'OperatorPass123')
    const res = await request(ctx.app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${operatorToken}`)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'FORBIDDEN')
  })

  it('R-AUD-4: auditor role can read audit (permission matrix)', async () => {
    await adminToken(ctx.app, ctx.pool)
    await createUser(ctx.pool, {
      username: 'aud1',
      email: 'aud1@test.local',
      password: 'AuditorPass123',
      role: 'auditor',
    })
    const auditorToken = await loginAndGetToken(ctx.app, 'aud1', 'AuditorPass123')
    const res = await request(ctx.app)
      .get('/api/audit?action=auth.login')
      .set('Authorization', `Bearer ${auditorToken}`)
    assert.equal(res.status, 200)
    assert.ok((res.body.data as unknown[]).length >= 1)
  })

  it('R-AUD-4: unauthenticated -> 401 (requireAuth before permission)', async () => {
    const res = await request(ctx.app).get('/api/audit')
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')
  })

  it('R-AUD-4: from/to date window narrows results (parameterized, ISO datetimes)', async () => {
    const token = await adminToken(ctx.app, ctx.pool)
    // Append-only trigger blocks UPDATE/DELETE but INSERT with explicit
    // created_at is allowed — backdate three probe rows.
    const inserts: Array<[string, string]> = [
      ['2026-01-01T00:00:00Z', 'jan'],
      ['2026-06-15T00:00:00Z', 'jun'],
      ['2026-12-31T00:00:00Z', 'dec'],
    ]
    for (const [createdAt, action] of inserts) {
      await ctx.pool.query(
        `INSERT INTO audit_log (action, entity, entity_id, payload, created_at)
         VALUES ($1, 'probe', $2, '{}'::jsonb, $3)`,
        [action, action, createdAt],
      )
    }
    const res = await request(ctx.app)
      .get('/api/audit?entity=probe&from=2026-06-01T00:00:00Z&to=2026-12-31T23:59:59Z')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    const actions = (res.body.data as Array<{ action: string }>).map((r) => r.action).sort()
    assert.deepEqual(actions, ['dec', 'jun'])
    assert.equal(res.body.pagination.total, 2)
  })

  it('R-AUD-4: invalid date filter -> 422 VALIDATION_ERROR', async () => {
    const token = await adminToken(ctx.app, ctx.pool)
    const res = await request(ctx.app)
      .get('/api/audit?from=not-a-date')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-AUD-4: limit/page pagination applies (limit=1 -> 1 row, totalPages>1)', async () => {
    const token = await adminToken(ctx.app, ctx.pool)
    for (const name of ['A Corp', 'B Corp', 'C Corp']) {
      await request(ctx.app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name })
    }
    const res = await request(ctx.app)
      .get('/api/audit?entity=customer&limit=1&page=2')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 1)
    assert.equal(res.body.pagination.total, 3)
    assert.equal(res.body.pagination.totalPages, 3)
    assert.equal(res.body.pagination.page, 2)
  })
})