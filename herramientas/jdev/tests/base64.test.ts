import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { decodeBase64, encodeBase64 } from '../src/core/base64.ts'
import { Base64Error } from '../src/core/errors.ts'
import { runCli, runCliRaw } from './helpers/exec.ts'
import { cleanup, makeTempDir, writeTempFile } from './helpers/temp.ts'

describe('core/base64 unit', () => {
  it('encode: standard RFC 4648 padded by default', () => {
    assert.equal(encodeBase64(Buffer.from('hello')), 'aGVsbG8=')
  })

  it('encode: base64url defaults to NO padding; -p restores it', () => {
    assert.equal(encodeBase64(Buffer.from('hello'), { url: true }), 'aGVsbG8')
    assert.equal(encodeBase64(Buffer.from('hello'), { url: true, padding: true }), 'aGVsbG8=')
  })

  it('encode: url alphabet substitutes + and / with - and _', () => {
    const bytes = Buffer.from([0xff, 0xff, 0xff, 0xfb, 0xef, 0xbe])
    assert.equal(encodeBase64(bytes), '////++++')
    assert.equal(encodeBase64(bytes, { url: true }), '____----')
    // a 1-byte payload forces real padding: '/w==' standard, '_w' url, '_w==' url+p
    assert.equal(encodeBase64(Buffer.from([0xff])), '/w==')
    assert.equal(encodeBase64(Buffer.from([0xff]), { url: true }), '_w')
    assert.equal(encodeBase64(Buffer.from([0xff]), { url: true, padding: true }), '_w==')
  })

  it('decode: standard padded and url unpadded/padded variants', () => {
    assert.equal(decodeBase64('aGVsbG8=').toString('utf8'), 'hello')
    assert.equal(decodeBase64('aGVsbG8', { url: true }).toString('utf8'), 'hello')
    assert.equal(decodeBase64('aGVsbG8=', { url: true }).toString('utf8'), 'hello')
  })

  it('decode: invalid characters are rejected (Buffer.from would silently ignore them)', () => {
    for (const bad of ['!!!', 'aGVs!G8=', 'a b', 'a=b']) {
      assert.throws(() => decodeBase64(bad), (err: unknown) => {
        assert.ok(err instanceof Base64Error)
        assert.equal((err as Base64Error).code, 'INVALID_BASE64')
        assert.equal((err as Base64Error).exitCode, 2)
        return true
      }, `expected Base64Error for ${bad}`)
    }
  })

  it('decode: unpadded standard input is rejected (length not multiple of 4)', () => {
    assert.throws(() => decodeBase64('aGVsbG8'), Base64Error)
  })

  it('decode: excessive padding is rejected', () => {
    for (const bad of ['aGVsbG8====', 'aGVsbG8==', '====']) {
      assert.throws(() => decodeBase64(bad), Base64Error, `expected Base64Error for ${bad}`)
      assert.throws(() => decodeBase64(bad, { url: true }), Base64Error, `expected Base64Error for ${bad} (url)`)
    }
  })

  it('decode: empty input decodes to an empty buffer (exit-0 path)', () => {
    assert.deepEqual(decodeBase64(''), Buffer.alloc(0))
  })

  it('roundtrip: 64 KiB random binary survives encode -> decode in both alphabets', () => {
    const buf = randomBytes(64 * 1024)
    for (const url of [false, true]) {
      const enc = encodeBase64(buf, { url })
      const dec = decodeBase64(enc, { url })
      assert.ok(dec.equals(buf), `roundtrip failed for url=${url}`)
    }
  })
})

describe('base64 CLI', () => {
  it('encode reads stdin and prints padded standard base64 + newline, exit 0', () => {
    const r = runCli(['base64', 'encode'], { input: 'hello' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.equal(r.stdout, 'aGVsbG8=\n')
  })

  it('encode --url drops padding; --url -p restores it', () => {
    const url = runCli(['base64', 'encode', '--url'], { input: 'hello' })
    assert.equal(url.status, 0)
    assert.equal(url.stdout, 'aGVsbG8\n')
    const padded = runCli(['base64', 'encode', '--url', '-p'], { input: 'hello' })
    assert.equal(padded.status, 0)
    assert.equal(padded.stdout, 'aGVsbG8=\n')
  })

  it('decode prints the raw bytes with NO added newline (binary-safe)', () => {
    const r = runCli(['base64', 'decode'], { input: 'aGVsbG8=' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.equal(r.stdout, 'hello') // exact: no trailing \n
  })

  it('decode --url accepts unpadded input', () => {
    const r = runCli(['base64', 'decode', '--url'], { input: 'aGVsbG8' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, 'hello')
  })

  it('decode rejects invalid input: exit 2, empty stdout, clean stderr', () => {
    const r = runCli(['base64', 'decode'], { input: '!!!' })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.notEqual(r.stderr, '')
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'stderr must not contain stack frames')
    assert.doesNotMatch(r.stderr, /node:internal|file:\/\//, 'stderr must not contain module paths')
  })

  it('binary roundtrip through the CLI preserves 64 KiB random bytes', () => {
    const buf = randomBytes(64 * 1024)
    const enc = runCliRaw(['base64', 'encode'], { input: buf })
    assert.equal(enc.status, 0)
    const b64 = enc.stdout.toString('utf8').replace(/\n$/, '')
    const dec = runCliRaw(['base64', 'decode'], { input: b64 })
    assert.equal(dec.status, 0)
    assert.equal(dec.stderr.length, 0)
    assert.ok(dec.stdout.equals(buf), 'decoded bytes must equal the original input')
  })

  it('encode reads from a positional file and from -i', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'payload.txt', 'hi')
      const positional = runCli(['base64', 'encode', f])
      assert.equal(positional.status, 0)
      assert.equal(positional.stdout, 'aGk=\n')
      const viaInput = runCli(['base64', 'encode', '-i', f])
      assert.equal(viaInput.status, 0)
      assert.equal(viaInput.stdout, 'aGk=\n')
    } finally {
      await cleanup(dir)
    }
  })

  it('decode -p is a usage error (padding is encode-only, exit 1)', () => {
    const r = runCli(['base64', 'decode', '-p'], { input: 'aGVsbG8=' })
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /padding/)
  })

  it('base64 with no action is a missing-argument usage error (exit 1)', () => {
    const r = runCli(['base64'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /required argument/)
  })

  it('unknown action is a usage error (exit 1)', () => {
    const r = runCli(['base64', 'frobnicate'], { input: 'x' })
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /unknown base64 action/)
  })
})