import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { Pool } from 'pg'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { createApp } from '../../src/app.ts'

let pool: Pool | undefined

afterEach(async () => {
  await pool?.end()
})

describe('health endpoint (T-1-8, R-OBS-1)', () => {
  it('R-OBS-1: db up -> 200 {status:"ok", db:"up"}', async () => {
    const ctx: TestContext = createTestContext()
    pool = ctx.pool
    const res = await request(ctx.app).get('/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { status: 'ok', db: 'up' })
  })

  it('R-OBS-1: db down -> 503 {status:"degraded", db:"down"} (not a crash)', async () => {
    // Unreachable host with a bounded connect timeout — SELECT 1 fails fast.
    const brokenPool: Pool = new Pool({
      connectionString: 'postgres://postgres:postgres@localhost:1/nonexistent',
      connectionTimeoutMillis: 500,
    })
    brokenPool.on('error', () => {}) // silence ECONNREFUSED noise
    const app = createApp({
      db: brokenPool,
      config: { jwtSecret: 'x'.repeat(40), cookieSecret: 'y'.repeat(40), isProduction: false, appVersion: 'test' },
    })
    pool = brokenPool
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 503)
    assert.deepEqual(res.body, { status: 'degraded', db: 'down' })
  })

  it('health is public — no auth required, no token needed', async () => {
    const ctx: TestContext = createTestContext()
    pool = ctx.pool
    const res = await request(ctx.app).get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers['set-cookie'], undefined)
  })
})