import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decodeJwt } from '../src/core/jwt.ts'
import { JwtError } from '../src/core/errors.ts'
import { runCli } from './helpers/exec.ts'
import {
  CLASSIC_HEADER,
  CLASSIC_SIGNATURE,
  CLASSIC_TOKEN,
  INVALID_B64_PAYLOAD_TOKEN,
  INVALID_B64_TOKEN,
  NON_JSON_HEADER_TOKEN,
  NON_JSON_PAYLOAD_TOKEN,
  TWO_PART_TOKEN,
} from './helpers/tokens.ts'

describe('core/jwt unit', () => {
  it('decodeJwt: classic HS256 token -> header.alg HS256, payload John Doe', () => {
    const { header, payload } = decodeJwt(CLASSIC_TOKEN)
    assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' })
    assert.deepEqual(payload, { sub: '1234567890', name: 'John Doe', iat: 1516239022 })
  })

  it('decodeJwt: accepts unpadded base64url parts (JWT style)', () => {
    // classic parts have no "=" padding; must decode cleanly
    const { header } = decodeJwt(CLASSIC_TOKEN)
    assert.equal((header as { alg: string }).alg, 'HS256')
  })

  it('decodeJwt: result exposes ONLY header+payload — signature never returned', () => {
    const result = decodeJwt(CLASSIC_TOKEN)
    const keys = Object.keys(result).sort()
    assert.deepEqual(keys, ['header', 'payload'])
    assert.ok(!JSON.stringify(result).includes(CLASSIC_SIGNATURE), 'signature leaked into the result')
  })

  it('decodeJwt: 2 parts -> JwtError "expected 3 parts"', () => {
    assert.throws(
      () => decodeJwt(TWO_PART_TOKEN),
      (err: unknown) => {
        assert.ok(err instanceof JwtError)
        assert.match((err as Error).message, /expected 3 parts/)
        assert.equal((err as JwtError).code, 'INVALID_JWT')
        return true
      },
    )
  })

  it('decodeJwt: 4 parts -> JwtError', () => {
    assert.throws(() => decodeJwt('a.b.c.d'), JwtError)
  })

  it('decodeJwt: empty token -> JwtError', () => {
    assert.throws(() => decodeJwt(''), JwtError)
  })

  it('decodeJwt: invalid base64url HEADER -> JwtError, message names the part, not its content', () => {
    assert.throws(
      () => decodeJwt(INVALID_B64_TOKEN),
      (err: unknown) => {
        assert.ok(err instanceof JwtError)
        assert.match((err as Error).message, /base64url/)
        assert.match((err as Error).message, /header/)
        assert.ok(!(err as Error).message.includes('!!!'), 'error must not echo the offending part')
        return true
      },
    )
  })

  it('decodeJwt: invalid base64url PAYLOAD -> JwtError naming the payload part', () => {
    assert.throws(
      () => decodeJwt(INVALID_B64_PAYLOAD_TOKEN),
      (err: unknown) => {
        assert.ok(err instanceof JwtError)
        assert.match((err as Error).message, /base64url/)
        assert.match((err as Error).message, /payload/)
        return true
      },
    )
  })

  it('decodeJwt: non-JSON payload (valid base64url) -> JwtError', () => {
    assert.throws(
      () => decodeJwt(NON_JSON_PAYLOAD_TOKEN),
      (err: unknown) => {
        assert.ok(err instanceof JwtError)
        assert.match((err as Error).message, /payload/)
        assert.ok(!(err as Error).message.includes('not json'), 'error must not echo decoded text')
        return true
      },
    )
  })

  it('decodeJwt: non-JSON header -> JwtError', () => {
    assert.throws(
      () => decodeJwt(NON_JSON_HEADER_TOKEN),
      (err: unknown) => {
        assert.ok(err instanceof JwtError)
        assert.match((err as Error).message, /header/)
        return true
      },
    )
  })

  it('decodeJwt: header parsed even when payload is bad (error mentions payload)', () => {
    assert.throws(() => decodeJwt(`${CLASSIC_HEADER}.bm90IGpzb24.sig`), /payload/)
  })
})

describe('jwt CLI', () => {
  it('decode classic token: pretty JSON with header+payload, exit 0', () => {
    const r = runCli(['jwt', CLASSIC_TOKEN])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const parsed = JSON.parse(r.stdout) as { header: Record<string, unknown>; payload: Record<string, unknown> }
    assert.equal(parsed.header.alg, 'HS256')
    assert.equal(parsed.header.typ, 'JWT')
    assert.equal(parsed.payload.name, 'John Doe')
    assert.equal(parsed.payload.sub, '1234567890')
    assert.equal(parsed.payload.iat, 1516239022)
  })

  it('SECURITY: signature string appears NOWHERE in stdout', () => {
    const r = runCli(['jwt', CLASSIC_TOKEN])
    assert.equal(r.status, 0)
    assert.ok(!r.stdout.includes(CLASSIC_SIGNATURE), 'signature leaked into stdout')
    // and the output is exactly ONE JSON document with exactly 2 top-level keys
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    assert.deepEqual(Object.keys(parsed).sort(), ['header', 'payload'])
  })

  it('wrong part count -> exit 2, stderr "expected 3 parts", stdout empty', () => {
    const r = runCli(['jwt', TWO_PART_TOKEN])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /expected 3 parts/)
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'no stack frames')
  })

  it('invalid base64url part -> exit 2, stdout empty', () => {
    const r = runCli(['jwt', INVALID_B64_TOKEN])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.notEqual(r.stderr, '')
    assert.ok(!r.stderr.includes('!!!'), 'stderr must not echo token content')
  })

  it('non-JSON payload -> exit 2, stdout empty', () => {
    const r = runCli(['jwt', NON_JSON_PAYLOAD_TOKEN])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /payload/)
  })

  it('non-JSON header -> exit 2, stdout empty', () => {
    const r = runCli(['jwt', NON_JSON_HEADER_TOKEN])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /header/)
  })

  it('no verify capability: --secret is an unknown option -> exit 1', () => {
    const r = runCli(['jwt', CLASSIC_TOKEN, '--secret', 'foo'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /unknown option/)
  })

  it('no verify capability: --verify is an unknown option -> exit 1', () => {
    const r = runCli(['jwt', CLASSIC_TOKEN, '--verify'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /unknown option/)
  })

  it('missing token argument -> usage error exit 1', () => {
    const r = runCli(['jwt'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
  })

  it('SECURITY: failing paths never echo the token in combined output', () => {
    for (const token of [TWO_PART_TOKEN, INVALID_B64_TOKEN, NON_JSON_PAYLOAD_TOKEN]) {
      const r = runCli(['jwt', token])
      assert.equal(r.status, 2)
      assert.ok(!(r.stdout + r.stderr).includes(token), 'token echoed on a failing path')
    }
  })
})