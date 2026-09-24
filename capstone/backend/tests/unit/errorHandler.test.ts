import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { ApiError, errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.ts'

function buildApp(): express.Express {
  const app = express()
  app.get('/api-error', () => {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request payload', [
      { path: 'email', message: 'Invalid email' },
    ])
  })
  app.get('/boom', () => {
    throw new Error('database exploded') // non-ApiError → generic 500
  })
  app.get('/conflict', () => {
    throw new ApiError(409, 'USERNAME_TAKEN', 'Username already in use')
  })
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

describe('errorHandler (F-6)', () => {
  it('ApiError -> uniform {error:{code,message}} body with status', async () => {
    const res = await request(buildApp()).get('/api-error')
    assert.equal(res.status, 422)
    assert.deepEqual(res.body, {
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request payload' },
    })
  })

  it('422 convention: ApiError 422 keeps details out of the wire shape', async () => {
    const res = await request(buildApp()).get('/api-error')
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    assert.equal(typeof res.body.error.message, 'string')
    // The uniform body has exactly {code,message} — no internals leak.
    assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message'])
  })

  it('409 conflict subcode surfaces as code (USERNAME_TAKEN)', async () => {
    const res = await request(buildApp()).get('/conflict')
    assert.equal(res.status, 409)
    assert.deepEqual(res.body, { error: { code: 'USERNAME_TAKEN', message: 'Username already in use' } })
  })

  it('unknown route -> 404 NOT_FOUND uniform body', async () => {
    const res = await request(buildApp()).get('/nope')
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'NOT_FOUND')
  })

  it('non-ApiError -> generic 500 INTERNAL_ERROR, internals never leak', async () => {
    const res = await request(buildApp()).get('/boom')
    assert.equal(res.status, 500)
    assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
    assert.ok(!JSON.stringify(res.body).includes('database exploded'))
  })
})