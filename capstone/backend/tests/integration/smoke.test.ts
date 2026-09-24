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

let ctx: TestContext

beforeEach(async () => {
  ctx = createTestContext()
  await resetDatabase(ctx.pool)
})

afterEach(async () => {
  await ctx.pool.end()
})

describe('smoke (F-8)', () => {
  it('GET / -> serves the verification UI (T-7-5 behavior change: root was 404 before it7)', async () => {
    const res = await request(ctx.app).get('/')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] as string, /text\/html/)
    assert.ok((res.text as string).includes('BOP v1'))
  })

  it('R-PROD-7 (modified): GET /app.js -> SPA fallback shell, vanilla script gone (T-2-1)', async () => {
    // The v1 vanilla app.js was REMOVED at T-2-1; a non-API GET falls back to
    // the SPA shell (R-BE-5). Hermetic fixture dist — no Vite build required.
    const distDir = mkdtempSync(path.join(tmpdir(), 'ui-dist-smoke-'))
    writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>SPA smoke</title><div id="root"></div>')
    const pool = createTestPool()
    await resetDatabase(pool)
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
      assert.ok((res.text as string).includes('id="root"'))
      assert.ok(!(res.text as string).includes('state.token'))
    } finally {
      await pool.end()
      rmSync(distDir, { recursive: true, force: true })
    }
  })

  it('unknown API route -> 404 uniform body', async () => {
    const res = await request(ctx.app).get('/api/does-not-exist')
    assert.equal(res.status, 404)
    assert.deepEqual(res.body, {
      error: { code: 'NOT_FOUND', message: 'Route GET /api/does-not-exist not found' },
    })
  })
})