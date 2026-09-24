import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import type { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken, adminToken } from '../helpers/users.ts'
import { sha256Hex } from '../../src/modules/auth/service.ts'

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

/** Extracts the refresh cookie line (name=value; attrs) from a supertest response. */
function refreshCookie(res: request.Response): string {
  const header = res.headers['set-cookie']
  assert.ok(Array.isArray(header), 'refresh cookie must be set')
  const line = header.find((c: string) => c.startsWith('refresh_token='))
  assert.ok(line, `refresh_token cookie missing in ${JSON.stringify(header)}`)
  return line
}

/** Extracts the RAW (unsigned, decoded) refresh token value from a cookie line. */
function rawRefreshToken(cookieLine: string): string {
  const raw = cookieLine.split(';')[0]!.split('=').slice(1).join('=')
  const decoded = decodeURIComponent(raw)
  // cookie-parser signed cookie: `s:<original>.<signature>` — original is a JWT
  // and may itself contain dots, so the signature is the LAST dot segment.
  const unsigned = decoded.startsWith('s:') ? decoded.slice(2) : decoded
  const lastDot = unsigned.lastIndexOf('.')
  return lastDot === -1 ? unsigned : unsigned.slice(0, lastDot)
}

describe('auth self-service locale (T-1-4, R-BE-4)', () => {
  it('R-BE-4: PATCH /api/auth/me {locale:"en"} -> 200 with user.locale en and the DB row updated', async () => {
    await createUser(pool, { username: 'locu', email: 'locu@test.local', password: 'Password1', role: 'viewer' })
    const token = await loginAndGetToken(ctx.app, 'locu', 'Password1')
    const res = await request(ctx.app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'en' })
    assert.equal(res.status, 200)
    assert.equal(res.body.user.locale, 'en', 'response user carries the new locale')
    const { rows } = await pool.query(`SELECT locale FROM users WHERE username = 'locu'`)
    assert.equal(rows[0]!.locale, 'en', 'DB row updated')
  })

  it('R-BE-4: invalid locale fr -> 422 VALIDATION_ERROR and stored locale unchanged', async () => {
    await createUser(pool, { username: 'locu2', email: 'locu2@test.local', password: 'Password1', role: 'viewer' })
    const token = await loginAndGetToken(ctx.app, 'locu2', 'Password1')
    const res = await request(ctx.app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'fr' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    const { rows } = await pool.query(`SELECT locale FROM users WHERE username = 'locu2'`)
    assert.equal(rows[0]!.locale, 'es', 'stored locale unchanged after invalid patch')
  })

  it('R-BE-4: PATCH /api/auth/me without a token -> 401 (same body as R-AUTH-2)', async () => {
    const res = await request(ctx.app).patch('/api/auth/me').send({ locale: 'en' })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')
  })

  it('R-BE-4: locale surfaces on every user object — login, refresh, me, users list', async () => {
    await createUser(pool, { username: 'locu3', email: 'locu3@test.local', password: 'Password1', role: 'manager' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'locu3', password: 'Password1' })
    assert.equal(login.status, 200)
    assert.equal(login.body.user.locale, 'es', 'login user object includes locale')

    const cookie = login.headers['set-cookie'] as unknown as string[]
    const refresh = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie[0]!)
    assert.equal(refresh.status, 200)
    assert.equal(refresh.body.user.locale, 'es', 'refresh user object includes locale')

    const me = await request(ctx.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
    assert.equal(me.status, 200)
    assert.equal(me.body.user.locale, 'es', 'me user object includes locale')

    // Admin list — every item carries locale.
    const adminId = await createUser(pool, { username: 'locadmin', email: 'locadmin@test.local', password: 'Password1', role: 'admin' })
    const adminToken = await loginAndGetToken(ctx.app, 'locadmin', 'Password1')
    const list = await request(ctx.app).get('/api/users').set('Authorization', `Bearer ${adminToken}`)
    assert.equal(list.status, 200)
    assert.ok(list.body.data.length >= 2, 'users listed')
    for (const u of list.body.data as Array<{ username: string; locale?: string }>) {
      assert.equal(u.locale, 'es', `user ${u.username} carries locale in the list DTO`)
    }
    assert.ok(adminId.id, 'admin seeded')
  })

  it('R-BE-4: POST /api/users does NOT accept locale (self-service only, locked delta)', async () => {
    const token = await adminToken(ctx.app, pool)
    const res = await request(ctx.app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'nolocale',
        email: 'nolocale@test.local',
        password: 'NoLocalePass1',
        role: 'viewer',
        locale: 'en',
      })
    assert.equal(res.status, 422, 'strict schema rejects the locale field on user create')
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE username = 'nolocale'`)
    assert.equal(rows[0]!.n, 0, 'no user created')
  })
})

describe('auth integration (T-1-7)', () => {
  it('R-AUTH-2: login success returns user + accessToken + httpOnly refresh cookie', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const res = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    assert.equal(res.status, 200)
    assert.equal(typeof res.body.accessToken, 'string')
    assert.ok(res.body.accessToken.length > 20)
    assert.equal(res.body.user.username, 'pepe')
    assert.equal(res.body.user.role, 'operator')
    assert.equal(res.body.user.active, true)
    const cookie = refreshCookie(res)
    assert.match(cookie, /^refresh_token=.+;/, 'refresh cookie must be set')
    assert.match(cookie, /HttpOnly/, 'refresh cookie must be httpOnly')
    // accessToken is a valid JWT with typ=access and 15-min exp (R-AUTH-3).
    const decoded = jwt.verify(res.body.accessToken, ctx.jwtSecret) as jwt.JwtPayload
    assert.equal(decoded.typ, 'access')
    assert.equal(decoded.sub, String(res.body.user.id))
    const ttl = decoded.exp! - decoded.iat!
    assert.equal(ttl, 15 * 60)
  })

  it('R-AUTH-2: unknown username -> 401 identical to wrong-password body (no enumeration)', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const unknown = await request(ctx.app).post('/api/auth/login').send({ username: 'nobody', password: 'Password1' })
    const wrongPw = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'WrongPass1' })
    assert.equal(unknown.status, 401)
    assert.equal(wrongPw.status, 401)
    assert.deepEqual(unknown.body, { error: { code: 'UNAUTHORIZED', message: 'Invalid username or password' } })
    assert.deepEqual(wrongPw.body, { error: { code: 'UNAUTHORIZED', message: 'Invalid username or password' } })
    assert.equal(JSON.stringify(unknown.body), JSON.stringify(wrongPw.body), 'bodies must be byte-identical')
  })

  it('R-AUTH-2: inactive user -> 401 with the same body', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'viewer' })
    await pool.query(`UPDATE users SET active = false WHERE username = 'pepe'`)
    const res = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: { code: 'UNAUTHORIZED', message: 'Invalid username or password' } })
  })

  it('R-AUTH-3: expired access token -> 401', async () => {
    const user = await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'viewer' })
    const expired = jwt.sign(
      { sub: user.id, username: 'pepe', role: 'viewer', typ: 'access', jti: 'x' },
      ctx.jwtSecret,
      { expiresIn: -60 },
    )
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`)
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')
  })

  it('R-AUTH-3: refresh token used as access (wrong typ) -> 401', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'viewer' })
    // typ must live in the PAYLOAD (jsonwebtoken v9 rejects it in options).
    const refresh = jwt.sign(
      { sub: '1', jti: 'jti', fam: 'fam', typ: 'refresh' },
      ctx.jwtSecret,
      { expiresIn: 60 * 60 * 24 * 7 },
    )
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${refresh}`)
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')
  })

  it('R-AUTH-3: valid token passes auth middleware (me endpoint)', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'auditor' })
    const token = await loginAndGetToken(ctx.app, 'pepe', 'Password1')
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.user.username, 'pepe')
    assert.equal(res.body.user.role, 'auditor')
  })

  it('R-AUTH-4: refresh rotation — cookie #1 rotates to #2, replay of #1 -> 401', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    const cookie1 = refreshCookie(login)

    const rotated = await request(ctx.app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie1)
    assert.equal(rotated.status, 200)
    const cookie2 = refreshCookie(rotated)
    assert.notEqual(cookie1, cookie2, 'refresh must rotate to a new cookie')

    const replay = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie1)
    assert.equal(replay.status, 401, 'used refresh token must be rejected')
    assert.equal(replay.body.error.code, 'UNAUTHORIZED')
  })

  it('R-AUTH-4: reuse detection — replay of #1 after rotation invalidates the whole family (#2 dies too)', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    const cookie1 = refreshCookie(login)
    const rotated = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie1)
    assert.equal(rotated.status, 200)
    const cookie2 = refreshCookie(rotated)

    const attack = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie1)
    assert.equal(attack.status, 401)

    const victim = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie2)
    assert.equal(victim.status, 401, 'family must be invalidated: rotated cookie #2 must also fail')
    assert.equal(victim.body.error.code, 'UNAUTHORIZED')
  })

  it('R-AUTH-4: refresh for a deactivated user -> 401', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    const cookie1 = refreshCookie(login)
    await pool.query(`UPDATE users SET active = false WHERE username = 'pepe'`)
    const res = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie1)
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')
  })

  it('R-AUTH-5: logout -> 204 and the old refresh cookie is dead', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    const cookie1 = refreshCookie(login)
    const token = login.body.accessToken as string

    const logout = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie1)
    assert.equal(logout.status, 204)

    const refresh = await request(ctx.app).post('/api/auth/refresh').set('Cookie', cookie1)
    assert.equal(refresh.status, 401, 'logout must invalidate the refresh token')
  })

  it('R-AUTH-5: double logout -> 204 both times (idempotent)', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    const cookie1 = refreshCookie(login)
    const token = login.body.accessToken as string

    const first = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie1)
    assert.equal(first.status, 204)
    const second = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie1)
    assert.equal(second.status, 204)
  })

  it('R-NFR-1: SQL injection attempt via login username is inert (401, users table intact)', async () => {
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM users`)
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: `'; DROP TABLE users;--`, password: 'Password1' })
    assert.equal(res.status, 401)
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM users`)
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'users table must be intact')
  })

  it('R-NFR-5: refresh tokens are stored as SHA-256 hashes, never raw tokens', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    const raw = rawRefreshToken(refreshCookie(login))
    const { rows } = await pool.query(`SELECT token_hash FROM refresh_tokens`)
    assert.equal(rows.length, 1)
    assert.notEqual(rows[0]!.token_hash, raw, 'raw token must never be stored')
    assert.equal(rows[0]!.token_hash, sha256Hex(raw), 'stored value must be SHA-256 of the token')
  })

  it('R-AUD-3: login audit payload carries actor/ip only — no password/hash/token fields', async () => {
    await createUser(pool, { username: 'pepe', email: 'pepe@test.local', password: 'Password1', role: 'operator' })
    const res = await request(ctx.app).post('/api/auth/login').send({ username: 'pepe', password: 'Password1' })
    assert.equal(res.status, 200)
    const { rows } = await pool.query(
      `SELECT payload FROM audit_log WHERE action = 'auth.login' ORDER BY id DESC LIMIT 1`,
    )
    assert.equal(rows.length, 1, 'login success must write an audit row')
    const payload = rows[0]!.payload as Record<string, unknown>
    const serialized = JSON.stringify(payload)
    assert.ok(!serialized.includes('Password1'), 'no password value in audit payload')
    for (const forbidden of ['password', 'token', 'hash', 'secret']) {
      assert.ok(
        !Object.keys(payload).some((k) => k.toLowerCase().includes(forbidden)),
        `audit payload must not contain ${forbidden}-like keys: ${Object.keys(payload).join(',')}`,
      )
    }
    assert.ok(payload.username === 'pepe' || payload.actor === 'pepe', 'actor identity present')
  })
})