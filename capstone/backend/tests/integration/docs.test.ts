import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase } from '../helpers/db.ts'
import { NOTIFICATION_TYPES } from '../../src/modules/notifications/types.ts'

let ctx: TestContext

beforeEach(async () => {
  ctx = createTestContext()
  await resetDatabase(ctx.pool)
})

afterEach(async () => {
  await ctx.pool.end()
})

/** The complete v1 endpoint surface (spec API contract table) — every path must be documented. */
const V1_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/users',
  '/api/users/{id}',
  '/api/customers',
  '/api/customers/{id}',
  '/api/orders',
  '/api/orders/{id}',
  '/api/orders/{id}/confirm',
  '/api/orders/{id}/cancel',
  '/api/products',
  '/api/products/{id}',
  '/api/warehouses',
  '/api/warehouses/{id}',
  '/api/stock',
  '/api/stock/movements',
  '/api/stock/transfers',
  '/api/notifications',
  '/api/notifications/{id}/read',
  '/api/jobs',
  '/api/jobs/{id}/retry',
  '/api/audit',
  '/api/health',
  '/api/status',
  '/api/docs',
] as const

describe('OpenAPI docs (T-6-4, R-DOC-1)', () => {
  it('R-DOC-1: GET /api/docs -> 200 HTML (self-hosted Swagger UI, offline)', async () => {
    const res = await request(ctx.app).get('/api/docs')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] as string, /text\/html/)
    assert.ok((res.text as string).includes('swagger-ui'), 'HTML must load the bundled Swagger UI')
  })

  it('R-DOC-1: GET /api/docs.json -> spec contains paths for ALL v1 endpoints', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    assert.equal(res.status, 200)
    assert.equal(res.body.openapi, '3.1.0')
    const documented = Object.keys(res.body.paths as Record<string, unknown>)
    for (const path of V1_PATHS) {
      assert.ok(documented.includes(path), `missing path in OpenAPI spec: ${path}`)
    }
  })

  it('R-DOC-1: login request schema is derived from the zod DTO (single source of truth)', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    const loginProps = res.body.components.schemas.LoginInput.properties as Record<string, unknown>
    assert.deepEqual(Object.keys(loginProps).sort(), ['password', 'username'])
  })

  it('R-DOC-1: notification types registered as enum from the NOTIFICATION_TYPES registry', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    const enumValues = res.body.components.schemas.NotificationType.enum as string[]
    const expected = Object.values(NOTIFICATION_TYPES).sort()
    assert.deepEqual([...enumValues].sort(), expected)
  })

  it('R-DOC-1: money fields documented as string with the D13 pattern (ADR-8)', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    const money = res.body.components.schemas.Money as { type: string; pattern: string }
    assert.equal(money.type, 'string')
    assert.equal(money.pattern, '^\\d+\\.\\d{2}$')
  })

  it('R-DOC-1: public paths have no security requirement; protected paths do', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    const login = res.body.paths['/api/auth/login'].post as { security?: unknown }
    const audit = res.body.paths['/api/audit'].get as { security?: unknown }
    assert.equal(login.security, undefined, 'login is public')
    assert.ok(Array.isArray(audit.security) && audit.security.length > 0, 'protected endpoint declares security')
  })

  it('R-DOC-1 (capstone-ui it1): PATCH /api/auth/me documented with the locale field on user schemas', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    const patch = res.body.paths['/api/auth/me'].patch as { security?: unknown; requestBody?: unknown }
    assert.ok(patch, 'PATCH /api/auth/me documented')
    assert.ok(Array.isArray(patch.security) && patch.security.length > 0, 'patch requires auth')
    // The request body derives from patchMeSchema (locale enum es|en).
    const schema = (patch.requestBody as {
      content: { 'application/json': { schema: { properties?: { locale?: { enum?: string[] } } } } }
    }).content['application/json'].schema
    assert.deepEqual(schema.properties!.locale!.enum, ['es', 'en'], 'locale enum whitelist in the spec')

    // Every user-shaped schema carries the locale field.
    for (const schemaName of ['User', 'UserLoginResult']) {
      const component = res.body.components.schemas[schemaName]
      const userProps = schemaName === 'User' ? component.properties : component.properties.user.properties
      assert.equal(userProps.locale.type, 'string', `${schemaName} user object documents locale`)
    }
  })

  it('R-DOC-1 (capstone-ui it1): products PATCH + warehouses GET/PATCH/DELETE documented', async () => {
    const res = await request(ctx.app).get('/api/docs.json')
    const paths = res.body.paths as Record<string, Record<string, unknown>>
    assert.ok(paths['/api/products/{id}'], 'products {id} path documented')
    assert.ok(paths['/api/products/{id}']!.patch, 'PATCH /api/products/{id} documented')
    assert.ok(paths['/api/warehouses'], 'warehouses path documented')
    assert.ok(paths['/api/warehouses']!.get, 'GET /api/warehouses documented')
    assert.ok(paths['/api/warehouses/{id}'], 'warehouses {id} path documented')
    assert.ok(paths['/api/warehouses/{id}']!.patch, 'PATCH /api/warehouses/{id} documented (rename)')
    assert.ok(paths['/api/warehouses/{id}']!.delete, 'DELETE /api/warehouses/{id} documented')

    // The jobs list query exposes the state/queue filters (R-UI-JOB-1 server-side).
    const jobsQuery = paths['/api/jobs']!.get as { parameters?: Array<{ name?: string }> }
    const paramNames = (jobsQuery.parameters ?? []).map((p) => p.name)
    assert.ok(paramNames.includes('state') && paramNames.includes('queue'), 'jobs filters in the docs')
  })
})