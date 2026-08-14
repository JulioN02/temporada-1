import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BcryptLengthError } from '../src/core/errors.ts'
import { generatePassword, hashPassword, verifyPassword } from '../src/core/password.ts'
import { runCli } from './helpers/exec.ts'

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
const CHARSET_RE = /^[A-Za-z0-9_-]+$/

describe('core/password unit', () => {
  it('hashPassword: output matches the bcrypt shape with cost 10', () => {
    const h = hashPassword('MiClave123!')
    assert.match(h, BCRYPT_RE)
    assert.ok(h.startsWith('$2b$10$'), `expected cost-10 prefix, got ${h.slice(0, 7)}`)
  })

  it('hashPassword: honors the cost parameter', () => {
    const h = hashPassword('MiClave123!', 4)
    assert.ok(h.startsWith('$2b$04$'), h)
    assert.match(h, BCRYPT_RE)
  })

  it('verifyPassword: matching password -> { ok: true, malformed: false }', () => {
    const h = hashPassword('MiClave123!')
    assert.deepEqual(verifyPassword('MiClave123!', h), { ok: true, malformed: false })
  })

  it('verifyPassword: wrong password -> { ok: false, malformed: false }', () => {
    const h = hashPassword('MiClave123!')
    assert.deepEqual(verifyPassword('otra', h), { ok: false, malformed: false })
  })

  it('verifyPassword: malformed hash -> { ok: false, malformed: true }, no throw', () => {
    assert.deepEqual(verifyPassword('x', 'no-es-un-hash'), { ok: false, malformed: true })
  })

  it('verifyPassword: near-valid malformed variants are flagged, not compared', () => {
    // correct prefix but truncated tail
    assert.deepEqual(verifyPassword('x', '$2b$10$ab'), { ok: false, malformed: true })
    // invalid version letter
    assert.deepEqual(verifyPassword('x', `$2z$10$${'a'.repeat(53)}`), { ok: false, malformed: true })
    // non-digit cost
    assert.deepEqual(verifyPassword('x', `$2b$ab$${'a'.repeat(53)}`), { ok: false, malformed: true })
  })

  it('72-byte guard: 73 ASCII bytes rejected in BOTH hash and verify paths', () => {
    const tooLong = 'a'.repeat(73)
    assert.throws(
      () => hashPassword(tooLong),
      (err: unknown) => {
        assert.ok(err instanceof BcryptLengthError)
        assert.equal((err as BcryptLengthError).code, 'BCRYPT_LENGTH_EXCEEDED')
        return true
      },
    )
    assert.throws(
      () => verifyPassword(tooLong, `$2b$10$${'x'.repeat(53)}`),
      (err: unknown) => {
        assert.ok(err instanceof BcryptLengthError)
        return true
      },
    )
  })

  it('72-byte guard: counts UTF-8 BYTES, not chars (37 ñ rejected; 36 ñ accepted)', () => {
    assert.throws(() => hashPassword('ñ'.repeat(37)), BcryptLengthError)
    const h = hashPassword('ñ'.repeat(36))
    assert.match(h, BCRYPT_RE)
    assert.equal(verifyPassword('ñ'.repeat(36), h).ok, true)
  })

  it('72-byte guard: exactly 72 bytes is accepted (boundary)', () => {
    const h = hashPassword('a'.repeat(72))
    assert.equal(verifyPassword('a'.repeat(72), h).ok, true)
  })

  it('generatePassword: exact length, alphabet-only, no whitespace', () => {
    assert.equal(generatePassword(24).length, 24)
    assert.match(generatePassword(24), CHARSET_RE)
    assert.doesNotMatch(generatePassword(24), /\s/)
  })

  it('generatePassword: default length 16; 100 calls yield 100 distinct values', () => {
    assert.equal(generatePassword().length, 16)
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(generatePassword(24))
    assert.equal(seen.size, 100)
  })

  it('generatePassword: every character comes from the 64-char alphabet', () => {
    for (let i = 0; i < 20; i++) {
      for (const ch of generatePassword(32)) assert.match(ch, /^[A-Za-z0-9_-]$/)
    }
  })
})

describe('password CLI', () => {
  it('hash: stdout matches bcrypt regex, exit 0, stderr empty; the hash verifies', () => {
    const r = runCli(['password', 'hash', 'MiClave123!'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const h = r.stdout.trim()
    assert.match(h, BCRYPT_RE)
    assert.equal(r.stdout, `${h}\n`, 'data purity: exactly one line on stdout')
    const v = runCli(['password', 'verify', 'MiClave123!', h])
    assert.equal(v.status, 0)
    assert.equal(v.stdout, 'password match\n')
    assert.equal(v.stderr, '')
  })

  it('hash: --cost 4 -> $2b$04$ prefix, still a valid bcrypt hash', () => {
    const r = runCli(['password', 'hash', 'MiClave123!', '--cost', '4'])
    assert.equal(r.status, 0)
    assert.ok(r.stdout.startsWith('$2b$04$'), r.stdout)
    assert.match(r.stdout.trim(), BCRYPT_RE)
  })

  it('hash: invalid --cost is a usage error (exit 1, empty stdout)', () => {
    const r = runCli(['password', 'hash', 'x', '--cost', 'abc'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /--cost/)
  })

  it('verify: match -> exit 0 with "password match" on stdout (explicit confirmation)', () => {
    const h = runCli(['password', 'hash', 'MiClave123!']).stdout.trim()
    const v = runCli(['password', 'verify', 'MiClave123!', h])
    assert.equal(v.status, 0)
    assert.equal(v.stdout, 'password match\n')
    assert.equal(v.stderr, '')
  })

  it('verify: mismatch -> exit 2 with explicit "password mismatch" verdict (no diagnostic leak)', () => {
    const h = runCli(['password', 'hash', 'MiClave123!']).stdout.trim()
    const v = runCli(['password', 'verify', 'otra', h])
    assert.equal(v.status, 2)
    assert.equal(v.stdout, 'password mismatch\n')
    assert.equal(v.stderr, '')
  })

  it('verify: malformed hash -> exit 2, stdout empty, stderr explains', () => {
    const v = runCli(['password', 'verify', 'x', 'no-es-un-hash'])
    assert.equal(v.status, 2)
    assert.equal(v.stdout, '')
    assert.match(v.stderr, /hash/)
    assert.doesNotMatch(v.stderr, /^\s+at /m, 'no stack frames')
    assert.doesNotMatch(v.stderr, /node:internal|file:\/\//, 'no module paths')
  })

  it('hash: 73-byte password -> exit 2, stdout empty, stderr explains the 72-byte limit', () => {
    const r = runCli(['password', 'hash', 'a'.repeat(73)])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /72/)
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'no stack frames')
  })

  it('verify: 73-byte password -> exit 2 + stderr (guard active on verify path too)', () => {
    const h = runCli(['password', 'hash', 'x']).stdout.trim()
    const v = runCli(['password', 'verify', 'a'.repeat(73), h])
    assert.equal(v.status, 2)
    assert.equal(v.stdout, '')
    assert.match(v.stderr, /72/)
  })

  it('generate: --length 24 -> exactly 24 alphabet chars, single line, exit 0', () => {
    const r = runCli(['password', 'generate', '--length', '24'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const pw = r.stdout.trim()
    assert.equal(pw.length, 24)
    assert.match(pw, CHARSET_RE)
    assert.equal(r.stdout, `${pw}\n`, 'data purity: exactly one line on stdout')
  })

  it('generate: default length 16; 5 CLI invocations are all distinct', () => {
    const pws = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const r = runCli(['password', 'generate'])
      assert.equal(r.status, 0)
      const pw = r.stdout.trim()
      assert.equal(pw.length, 16)
      pws.add(pw)
    }
    assert.equal(pws.size, 5)
  })

  it('generate: invalid --length is a usage error (exit 1)', () => {
    const r = runCli(['password', 'generate', '--length', '0'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /--length/)
  })

  it('unknown action -> usage error, exit 1', () => {
    const r = runCli(['password', 'frobnicate', 'x'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /password/)
  })

  it('SECURITY: plaintext never appears in combined output of hash/verify paths', () => {
    const secret = 'Sup3rSecret!x'
    const h = runCli(['password', 'hash', secret])
    assert.equal(h.status, 0)
    assert.doesNotMatch(h.stdout + h.stderr, new RegExp(secret))

    const mismatch = runCli(['password', 'verify', secret, hashPassword('otra')])
    assert.equal(mismatch.status, 2)
    assert.doesNotMatch(mismatch.stdout + mismatch.stderr, new RegExp(secret))

    const malformed = runCli(['password', 'verify', secret, 'no-es-un-hash'])
    assert.equal(malformed.status, 2)
    assert.doesNotMatch(malformed.stdout + malformed.stderr, new RegExp(secret))
  })
})