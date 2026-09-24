import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Express } from 'express'
import { pino } from 'pino'
import request from 'supertest'
import type { Pool } from 'pg'
import { createApp } from '../../src/app.ts'
import { createTestPool, resetDatabase } from '../helpers/db.ts'
import { createBossEnqueuer } from '../../src/lib/pgBossTx.ts'

/**
 * T-1-8 / capstone-ui it1 — R-BE-5: SPA history-fallback serving.
 * Ordering in app.ts: API routers → express.static(uiDistDir) → SPA fallback
 * (non-/api GET) → JSON 404 for /api → errorHandler. The `uiDistDir` dep is
 * INJECTED with a temp fixture dir — hermetic, no Vite build required.
 */

interface SpaContext {
  app: Express
  pool: Pool
  distDir: string
}

let ctx: SpaContext

beforeEach(async () => {
  const pool = createTestPool()
  await resetDatabase(pool)
  const distDir = mkdtempSync(path.join(tmpdir(), 'ui-dist-'))
  mkdirSync(path.join(distDir, 'assets'), { recursive: true })
  writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>SPA fixture</title><div id="root"></div>')
  writeFileSync(path.join(distDir, 'assets', 'index-abc.js'), 'console.log("fixture asset")')

  const app = createApp({
    db: pool,
    config: { jwtSecret: 'x'.repeat(40), cookieSecret: 'y'.repeat(40), isProduction: false, appVersion: 'test' },
    logger: pino({ level: 'silent' }),
    boss: createBossEnqueuer(pool),
    uiDistDir: distDir,
  })
  ctx = { app, pool, distDir }
})

afterEach(async () => {
  await ctx.pool.end()
  rmSync(ctx.distDir, { recursive: true, force: true })
})

describe('SPA fallback serving (T-1-8, R-BE-5)', () => {
  it('R-BE-5: deep link GET /orders/42 (no such static file) -> 200 with index.html (SPA shell)', async () => {
    const res = await request(ctx.app).get('/orders/42')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] as string, /text\/html/)
    assert.ok((res.text as string).includes('SPA fixture'), 'serves the SPA shell, not a 404')
    assert.ok((res.text as string).includes('id="root"'), 'serves the index.html content')
  })

  it('R-BE-5: unknown /api/* route -> JSON 404 (NOT index.html — fallback must not swallow API 404s)', async () => {
    const res = await request(ctx.app).get('/api/does-not-exist')
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'NOT_FOUND', 'JSON error contract preserved')
    assert.match(res.headers['content-type'] as string, /application\/json/)
  })

  it('R-BE-5: static asset wins over the fallback — GET /assets/index-abc.js serves the file', async () => {
    const res = await request(ctx.app).get('/assets/index-abc.js')
    assert.equal(res.status, 200)
    assert.equal(res.text, 'console.log("fixture asset")', 'exact asset bytes from the dist dir')
    assert.match(res.headers['content-type'] as string, /javascript/)
  })

  it('R-BE-5: non-GET non-API requests keep the JSON 404 (fallback is GET-only)', async () => {
    const res = await request(ctx.app).post('/orders/42')
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'NOT_FOUND')
  })
})