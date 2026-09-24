import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { createLogger } from '../../src/lib/logger.ts'

/** Captures pino JSON lines into an array for assertions. */
function captureLogger(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString())
      cb()
    },
  })
  return { lines, logger: createLogger(stream) }
}

describe('logger (F-6, R-NFR-2)', () => {
  it('R-NFR-2: password values are redacted from output', () => {
    const { lines, logger } = captureLogger()
    logger.info({ password: 'SuperSecret123', user: 'admin' }, 'login attempt')
    assert.equal(lines.length, 1)
    assert.ok(!lines[0]!.includes('SuperSecret123'), 'password value must be redacted')
    assert.ok(lines[0]!.includes('[Redacted]'))
    assert.ok(lines[0]!.includes('"user":"admin"'))
  })

  it('R-NFR-2: token values are redacted (top-level, camelCase and nested token keys)', () => {
    const { lines, logger } = captureLogger()
    logger.info(
      { token: 'raw-token-1', accessToken: 'jwt-abc', refreshToken: 'rt-xyz', session: { token: 'nested-token' } },
      'tokens',
    )
    const line = lines[0]!
    assert.ok(!line.includes('raw-token-1'))
    assert.ok(!line.includes('jwt-abc'))
    assert.ok(!line.includes('rt-xyz'))
    assert.ok(!line.includes('nested-token'))
    assert.ok(line.includes('[Redacted]'))
  })

  it('R-NFR-2: SMTP secrets (smtp* paths) are redacted', () => {
    const { lines, logger } = captureLogger()
    logger.info({ smtpPass: 'mailpit-secret', smtpUser: 'mailpit-user' }, 'smtp config')
    const line = lines[0]!
    assert.ok(!line.includes('mailpit-secret'))
    assert.ok(!line.includes('mailpit-user'))
    assert.ok(line.includes('[Redacted]'))
  })

  it('logs are parseable JSON lines', () => {
    const { lines, logger } = captureLogger()
    logger.info({ method: 'GET', status: 200 }, 'request')
    assert.doesNotThrow(() => JSON.parse(lines[0]!))
  })
})