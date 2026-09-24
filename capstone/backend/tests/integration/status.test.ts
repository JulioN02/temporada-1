import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { Writable } from 'node:stream'
import jwt from 'jsonwebtoken'
import { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'
import { createApp } from '../../src/app.ts'
import { createLogger } from '../../src/lib/logger.ts'

let ctx: TestContext

beforeEach(async () => {
  ctx = createTestContext()
  await resetDatabase(ctx.pool)
})

afterEach(async () => {
  await ctx.pool.end()
})

describe('status endpoint (T-6-3, R-OBS-2 + ADR-6)', () => {
  it('R-OBS-2: authenticated -> 200 with all fields (version, uptimeSeconds, db, timestamp, queues)', async () => {
    await createUser(ctx.pool, {
      username: 'viewer1',
      email: 'viewer1@test.local',
      password: 'ViewerPass123',
      role: 'viewer',
    })
    const token = await loginAndGetToken(ctx.app, 'viewer1', 'ViewerPass123')
    const res = await request(ctx.app).get('/api/status').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    const body = res.body as Record<string, unknown>
    assert.equal(body['version'], 'test')
    assert.ok(typeof body['uptimeSeconds'] === 'number' && (body['uptimeSeconds'] as number) >= 0)
    assert.equal(body['db'], 'up')
    assert.ok(typeof body['timestamp'] === 'string' && !Number.isNaN(Date.parse(body['timestamp'] as string)))
    // ADR-6 additive field: pg-boss queue reachable after resetDatabase bootstraps it.
    assert.equal(body['queues'], 'up')
  })

  it('R-OBS-2: unauthenticated -> 401 UNAUTHORIZED', async () => {
    const res = await request(ctx.app).get('/api/status')
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')
  })

  it('R-OBS-2: any authenticated role may read status (viewer included, ADR-6)', async () => {
    await createUser(ctx.pool, {
      username: 'aud1',
      email: 'aud1@test.local',
      password: 'AuditorPass123',
      role: 'auditor',
    })
    const token = await loginAndGetToken(ctx.app, 'aud1', 'AuditorPass123')
    const res = await request(ctx.app).get('/api/status').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
  })

  it('R-OBS-2: db down -> still 200 with db:"down" and queues:"down" (readiness, never blocks/crashes)', async () => {
    const brokenPool: Pool = new Pool({
      connectionString: 'postgres://postgres:postgres@localhost:1/nonexistent',
      connectionTimeoutMillis: 300,
    })
    brokenPool.on('error', () => {})
    const secret = 's'.repeat(40)
    const app = createApp({
      db: brokenPool,
      config: { jwtSecret: secret, cookieSecret: 'c'.repeat(40), isProduction: false, appVersion: 'test' },
    })
    const token = jwt.sign({ sub: '1', username: 'admin', role: 'admin', typ: 'access' }, secret, {
      expiresIn: '15m',
    })
    const res = await request(app).get('/api/status').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.db, 'down')
    assert.equal(res.body.queues, 'down')
    await brokenPool.end()
  })
})

describe('request logs (T-6-3, R-OBS-3)', () => {
  it('R-OBS-3: every request emits one parseable JSON line with method/path/status/durationMs/requestId', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString())
        cb()
      },
    })
    const loggedApp = createApp({
      db: ctx.pool,
      config: { jwtSecret: ctx.jwtSecret, cookieSecret: ctx.cookieSecret, isProduction: false, appVersion: 'test' },
      logger: createLogger(stream),
    })
    await createUser(ctx.pool, {
      username: 'viewer1',
      email: 'viewer1@test.local',
      password: 'ViewerPass123',
      role: 'viewer',
    })
    const token = await loginAndGetToken(loggedApp, 'viewer1', 'ViewerPass123')
    await request(loggedApp)
      .get('/api/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.ok(lines.length >= 2, 'login + status requests each produce a log line')
    let foundStatusLine = false
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed['msg'] === 'request' && parsed['method'] === 'GET' && parsed['path'] === '/api/status') {
        foundStatusLine = true
        assert.equal(parsed['status'], 200)
        assert.ok(typeof parsed['durationMs'] === 'number')
        assert.ok(typeof parsed['requestId'] === 'string' && (parsed['requestId'] as string).length > 0)
      }
    }
    assert.ok(foundStatusLine, 'a request log line for GET /api/status with the full R-OBS-3 shape')
  })

  it('R-OBS-3: log lines never contain token or password values (redact + no body logging)', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString())
        cb()
      },
    })
    const loggedApp = createApp({
      db: ctx.pool,
      config: { jwtSecret: ctx.jwtSecret, cookieSecret: ctx.cookieSecret, isProduction: false, appVersion: 'test' },
      logger: createLogger(stream),
    })
    const secretPassword = 'SuperSecretPwd789'
    const wrongToken = 'Bearer eyJhbGciOiJIUzI1NiJ9.fake-signature-abc123'
    await request(loggedApp)
      .post('/api/auth/login')
      .set('Authorization', wrongToken)
      .send({ username: 'ghost', password: secretPassword })
      .expect(401)

    assert.ok(lines.length >= 1)
    for (const line of lines) {
      JSON.parse(line) // parseable
      assert.ok(!line.includes(secretPassword), 'password value must never be logged')
      assert.ok(!line.includes('fake-signature-abc123'), 'token value must never be logged')
    }
  })
})