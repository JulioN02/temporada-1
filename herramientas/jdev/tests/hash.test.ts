import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hashStream, isHashAlgorithm } from '../src/core/hash.ts'
import { UsageError } from '../src/core/errors.ts'
import { openInput } from '../src/utils/io.ts'
import { runCli } from './helpers/exec.ts'
import { cleanup, makeTempDir, writeTempFile } from './helpers/temp.ts'

const SHA256_HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
const SHA256_HELLO_NL = '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03'
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const SHA512_HELLO = '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043'
const SHA512_EMPTY = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'

describe('core/hash unit', () => {
  it('sha256: hello hashes to the RFC reference digest', async () => {
    assert.equal(await hashStream(['hello']), SHA256_HELLO)
  })

  it('sha256: chunk boundaries do not change the digest (streaming)', async () => {
    assert.equal(await hashStream(['he', 'll', 'o']), SHA256_HELLO)
    assert.equal(await hashStream([Buffer.from('he'), 'll', Buffer.from('o')]), SHA256_HELLO)
  })

  it('sha256: empty input yields the empty digest', async () => {
    assert.equal(await hashStream([]), SHA256_EMPTY)
  })

  it('sha512: hello and empty match the sha512 references', async () => {
    assert.equal(await hashStream(['hello'], 'sha512'), SHA512_HELLO)
    assert.equal(await hashStream([], 'sha512'), SHA512_EMPTY)
  })

  it('isHashAlgorithm accepts only the supported algorithms', () => {
    assert.equal(isHashAlgorithm('sha256'), true)
    assert.equal(isHashAlgorithm('sha512'), true)
    assert.equal(isHashAlgorithm('md5'), false)
    assert.equal(isHashAlgorithm('SHA256'), false)
  })
})

describe('hash CLI', () => {
  it('known file digest: content hello\\n -> sha256 vector, exit 0', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'f.txt', 'hello\n')
      const r = runCli(['hash', f])
      assert.equal(r.status, 0)
      assert.equal(r.stderr, '')
      assert.equal(r.stdout, `${SHA256_HELLO_NL}\n`)
    } finally {
      await cleanup(dir)
    }
  })

  it('stdin digest: hello -> sha256 vector via stdin', () => {
    const r = runCli(['hash'], { input: 'hello' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, `${SHA256_HELLO}\n`)
  })

  it('empty stdin -> empty-input digest', () => {
    const r = runCli(['hash'], { input: '' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, `${SHA256_EMPTY}\n`)
  })

  it('--file is an alias of -i/--input (design deviation 3)', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'alias.txt', 'hello\n')
      const viaFile = runCli(['hash', '--file', f])
      assert.equal(viaFile.status, 0)
      assert.equal(viaFile.stdout, `${SHA256_HELLO_NL}\n`)
      const viaInput = runCli(['hash', '-i', f])
      assert.equal(viaInput.status, 0)
      assert.equal(viaInput.stdout, `${SHA256_HELLO_NL}\n`)
    } finally {
      await cleanup(dir)
    }
  })

  it('--algorithm sha512 selects the sha512 digest', () => {
    const r = runCli(['hash', '--algorithm', 'sha512'], { input: 'hello' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, `${SHA512_HELLO}\n`)
  })

  it('invalid --algorithm is a usage error (exit 1)', () => {
    const r = runCli(['hash', '--algorithm', 'md5'], { input: 'hello' })
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /--algorithm/)
  })

  it('large file streams: 64 MiB file matches the reference digest, exit 0', async () => {
    const dir = await makeTempDir()
    try {
      const size = 64 * 1024 * 1024
      const data = Buffer.alloc(size, 0x61) // 'a' pattern, deterministic
      const reference = createHash('sha256').update(data).digest('hex')
      const f = await writeTempFile(dir, 'big.bin', data)
      const r = runCli(['hash', f])
      assert.equal(r.status, 0)
      assert.equal(r.stdout, `${reference}\n`)
    } finally {
      await cleanup(dir)
    }
  })

  it('missing file: exit 2, empty stdout, stderr names the path (no stack frames)', async () => {
    const dir = await makeTempDir()
    try {
      const r = runCli(['hash', '--file', `${dir}/nope.txt`])
      assert.equal(r.status, 2)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /nope\.txt/)
      assert.doesNotMatch(r.stderr, /^\s+at /m, 'stderr must not contain stack frames')
      assert.doesNotMatch(r.stderr, /node:internal|file:\/\//, 'stderr must not contain module paths')
    } finally {
      await cleanup(dir)
    }
  })

  it('missing input on a TTY stdin raises UsageError (exit 1 taxonomy)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    try {
      assert.throws(() => openInput(undefined), (err: unknown) => {
        assert.ok(err instanceof UsageError)
        assert.equal((err as UsageError).code, 'MISSING_INPUT')
        assert.equal((err as UsageError).exitCode, 1)
        return true
      })
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    }
  })
})