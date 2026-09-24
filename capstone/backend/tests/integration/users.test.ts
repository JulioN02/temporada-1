import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import type { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken, adminToken } from '../helpers/users.ts'

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

const VALID_USER = { username: 'newbie', fullName: 'New User', email: 'newbie@test.local', role: 'operator', password: 'Passw0rd1234' }

describe('users integration (T-1-7, R-AUTH-1/6/8)', () => {
  it('R-AUTH-1: admin creates a user -> 201 and the user can log in', async () => {
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_USER)
    assert.equal(res.status, 201)
    assert.equal(res.body.user.username, 'newbie')
    assert.equal(res.body.user.role, 'operator')
    assert.equal(res.body.user.active, true)
    assert.equal(typeof res.body.user.id, 'string')

    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'newbie', password: VALID_USER.password })
    assert.equal(login.status, 200, 'created user must be able to log in')
  })

  it('R-AUTH-1: non-admin (operator) creating a user -> 403 FORBIDDEN', async () => {
    await createUser(pool, { username: 'op', email: 'op@test.local', password: 'Operator1', role: 'operator' })
    const token = await loginAndGetToken(ctx.app, 'op', 'Operator1')
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_USER)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'FORBIDDEN')
  })

  it('R-AUTH-1: duplicate username -> 409 USERNAME_TAKEN', async () => {
    await createUser(pool, { username: 'newbie', email: 'other@test.local', password: 'Passw0rd123', role: 'viewer' })
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_USER)
    assert.equal(res.status, 409)
    assert.equal(res.body.error.code, 'USERNAME_TAKEN')
  })

  it('R-AUTH-1: invalid role -> 422 VALIDATION_ERROR', async () => {
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_USER, role: 'superuser' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-AUTH-6: weak password -> 422', async () => {
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_USER, password: 'abc' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  })

  it('R-AUTH-6: stored password is a bcrypt hash starting $2b$10$, never plaintext', async () => {
    const token = await adminToken(ctx.app, pool)
    await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_USER)
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE username = 'newbie'`)
    const hash = rows[0]!.password_hash as string
    assert.match(hash, /^\$2b\$10\$/, 'bcrypt cost 10 hash required')
    assert.ok(!hash.includes('Passw0rd123'), 'plaintext must never be stored')
  })

  it('R-AUTH-6: password policy boundary — exactly 12 chars with letter+digit accepted', async () => {
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_USER, password: 'abcdefgh1xyz' }) // 12 chars, letter + digit
    assert.equal(res.status, 201)
    assert.equal(res.body.user.username, 'newbie')
  })

  it('R-AUTH-8: viewer token -> 403 on user_create (per-request DB check)', async () => {
    await createUser(pool, { username: 'viewer1', email: 'viewer1@test.local', password: 'Viewer123', role: 'viewer' })
    const token = await loginAndGetToken(ctx.app, 'viewer1', 'Viewer123')
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_USER)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'FORBIDDEN')
  })

  it('R-AUTH-8: role changed mid-session — same token, next request -> 403 (no re-issue needed)', async () => {
    // U is created as admin (can manage users) and logs in.
    const admin = await adminToken(ctx.app, pool)
    const created = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ ...VALID_USER, role: 'admin', username: 'boss', email: 'boss@test.local' })
    assert.equal(created.status, 201)
    const bossId = created.body.user.id as string
    const bossToken = await loginAndGetToken(ctx.app, 'boss', VALID_USER.password)
    const allowed = await request(ctx.app).get('/api/users').set('Authorization', `Bearer ${bossToken}`)
    assert.equal(allowed.status, 200, 'boss (admin role) can list users')

    // Admin demotes boss to viewer.
    const demote = await request(ctx.app)
      .patch(`/api/users/${bossId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'viewer' })
    assert.equal(demote.status, 200)
    assert.equal(demote.body.user.role, 'viewer')

    // Same JWT (role claim still 'admin') — DB check must deny now.
    const denied = await request(ctx.app).get('/api/users').set('Authorization', `Bearer ${bossToken}`)
    assert.equal(denied.status, 403, 'DB role check must reflect the demotion without token re-issue')
  })

  it('GET /api/users lists users with pagination metadata', async () => {
    const token = await adminToken(ctx.app, pool)
    await createUser(pool, { username: 'u1', email: 'u1@test.local', password: 'User1234', role: 'viewer' })
    await createUser(pool, { username: 'u2', email: 'u2@test.local', password: 'User1234', role: 'manager' })
    const res = await request(ctx.app).get('/api/users').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 3)
    assert.equal(res.body.pagination.total, 3)
    assert.equal(res.body.pagination.page, 1)
    assert.equal(res.body.pagination.limit, 20)
    assert.equal(res.body.pagination.totalPages, 1)
    const roles = res.body.data.map((u: { role: string }) => u.role).sort()
    assert.deepEqual(roles, ['admin', 'manager', 'viewer'])
  })

  it('PATCH /api/users/:id updates role and active; deactivated user login -> 401', async () => {
    const token = await adminToken(ctx.app, pool)
    const user = await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const patch = await request(ctx.app)
      .patch(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'viewer', active: false })
    assert.equal(patch.status, 200)
    assert.equal(patch.body.user.role, 'viewer')
    assert.equal(patch.body.user.active, false)

    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    assert.equal(login.status, 401)
  })

  it('PATCH /api/users/:id resets the password (new works, old fails)', async () => {
    const token = await adminToken(ctx.app, pool)
    const user = await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const patch = await request(ctx.app)
      .patch(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'NewPassw0rd99' })
    assert.equal(patch.status, 200)
    const oldLogin = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    assert.equal(oldLogin.status, 401)
    const newLogin = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'NewPassw0rd99' })
    assert.equal(newLogin.status, 200)
  })

  it('PATCH /api/users/999999 (unknown) -> 404', async () => {
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .patch('/api/users/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'viewer' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'NOT_FOUND')
  })

  it('PATCH requires auth:user_update (manager -> 403)', async () => {
    await createUser(pool, { username: 'mgr', email: 'mgr@test.local', password: 'Manager1', role: 'manager' })
    const mgrToken = await loginAndGetToken(ctx.app, 'mgr', 'Manager1')
    const user = await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const res = await request(ctx.app)
      .patch(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ role: 'viewer' })
    assert.equal(res.status, 403)
  })
})