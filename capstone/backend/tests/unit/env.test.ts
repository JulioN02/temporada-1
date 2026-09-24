import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from '../../src/config/env.ts'

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Valid env baseline (all required vars present, secrets >= 32 chars). */
function validEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3001',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:55437/bop_test',
    JWT_SECRET: 'jwt-secret-32-chars-minimum-abcdef',
    COOKIE_SECRET: 'cookie-secret-32-chars-minimum-abcdef',
    APP_VERSION: '0.1.0-test',
    SMTP_HOST: 'mailpit',
    SMTP_PORT: '1025',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: 'bop@localhost',
  }
}

/** Returns a copy of env without the given keys (avoiding delete narrowing). */
function without(env: Record<string, string>, ...keys: string[]): Record<string, string> {
  const copy: Record<string, string> = { ...env }
  for (const key of keys) delete copy[key]
  return copy
}

describe('env (F-3, R-PROD-5 fail-fast)', () => {
  it('R-PROD-5: short JWT_SECRET -> parseEnv throws naming JWT_SECRET, never echoing the value', () => {
    const env = { ...validEnv(), JWT_SECRET: 'abc' }
    assert.throws(
      () => parseEnv(env),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /JWT_SECRET/)
        assert.ok(!err.message.includes('abc'), 'error must not echo the secret value')
        return true
      },
    )
  })

  it('R-PROD-5: short COOKIE_SECRET -> throws naming COOKIE_SECRET, never echoing the value', () => {
    const env = { ...validEnv(), COOKIE_SECRET: 'short' }
    assert.throws(
      () => parseEnv(env),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /COOKIE_SECRET/)
        assert.ok(!err.message.includes('short'), 'error must not echo the secret value')
        return true
      },
    )
  })

  it('R-PROD-5: missing DATABASE_URL -> throws naming DATABASE_URL', () => {
    const env = without(validEnv(), 'DATABASE_URL')
    assert.throws(
      () => parseEnv(env),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /DATABASE_URL/)
        return true
      },
    )
  })

  it('R-PROD-5: never echoes ANY secret value present in the input', () => {
    const secretValue = 'S3CRET-VALUE-9876543210'
    const env = { ...validEnv(), JWT_SECRET: secretValue, COOKIE_SECRET: secretValue }
    assert.throws(
      () => parseEnv({ ...env, JWT_SECRET: 'x' }),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok(!err.message.includes(secretValue), 'no secret value may appear in the error')
        return true
      },
    )
  })

  it('valid env parses to config with defaults (PORT 3000, APP_VERSION dev)', () => {
    const env = without(validEnv(), 'PORT', 'APP_VERSION')
    const parsed = parseEnv(env)
    assert.equal(parsed.PORT, 3000)
    assert.equal(parsed.appConfig.appVersion, 'dev')
    assert.equal(parsed.appConfig.isProduction, false)
    assert.equal(parsed.appConfig.jwtSecret, validEnv().JWT_SECRET)
    assert.equal(parsed.smtp.host, 'mailpit')
  })

  it('production requires SMTP_* variables (no silent mailpit default)', () => {
    const env = without({ ...validEnv(), NODE_ENV: 'production' }, 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')
    assert.throws(
      () => parseEnv(env),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /SMTP_HOST/)
        assert.match(err.message, /SMTP_USER/)
        assert.match(err.message, /SMTP_PASS/)
        return true
      },
    )
  })

  it('invalid NODE_ENV -> throws (enum)', () => {
    assert.throws(() => parseEnv({ ...validEnv(), NODE_ENV: 'staging' }), /NODE_ENV/)
  })
})

describe('R-PROD-5 fail-fast startup + env template (T-7-6)', () => {
  it('R-PROD-5: server process exits non-zero on short JWT_SECRET, message names the var, never the value', () => {
    const badSecret = 'too-short'
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'src/server.ts'],
      {
        cwd: BACKEND_DIR,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: 'postgres://postgres:postgres@localhost:55437/bop_test',
          JWT_SECRET: badSecret,
          COOKIE_SECRET: 'cookie-secret-32-chars-minimum-abcdef',
        },
      },
    )
    assert.notEqual(result.status, 0, 'server must exit non-zero on invalid env')
    const output = result.stderr + result.stdout
    assert.match(output, /JWT_SECRET/, 'error message names the offending variable')
    assert.ok(!output.includes(badSecret), 'error message must never echo the secret value')
  })

  it('R-PROD-5: .env.example documents every required variable with blank secrets', () => {
    const example = readFileSync(path.join(BACKEND_DIR, '../.env.example'), 'utf8')
    for (const name of [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'JWT_SECRET',
      'COOKIE_SECRET',
      'APP_VERSION',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
    ]) {
      assert.ok(example.includes(name), `.env.example must document ${name}`)
    }
    // Secrets blank on purpose (never committed).
    assert.match(example, /^JWT_SECRET=\s*$/m, 'JWT_SECRET blank in template')
    assert.match(example, /^COOKIE_SECRET=\s*$/m, 'COOKIE_SECRET blank in template')
    assert.match(example, /^SMTP_PASS=\s*$/m, 'SMTP_PASS blank in template')
  })
})