import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatJson, minifyJson, validateJson } from '../src/core/json.ts'
import { JsonParseError, UsageError } from '../src/core/errors.ts'
import { readInput } from '../src/utils/io.ts'
import { runCli } from './helpers/exec.ts'
import { cleanup, makeTempDir, writeTempFile } from './helpers/temp.ts'

describe('core/json unit', () => {
  it('formatJson pretty-prints with 2-space indent', () => {
    assert.equal(
      formatJson('{"b":1,"a":[1,2]}'),
      '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}',
    )
  })

  it('minifyJson compacts to a single line', () => {
    assert.equal(minifyJson('{ "a" : 1 }'), '{"a":1}')
  })

  it('formatJson on invalid input throws JsonParseError carrying line/column/position', () => {
    assert.throws(() => formatJson('{"a":'), (err: unknown) => {
      assert.ok(err instanceof JsonParseError)
      assert.equal((err as JsonParseError).code, 'INVALID_JSON')
      assert.equal((err as JsonParseError).exitCode, 2)
      assert.deepEqual((err as JsonParseError).position, { line: 1, column: 6, position: 5 })
      assert.match((err as Error).message, /line 1, column 6/)
      return true
    })
  })

  it('validateJson reports ok for valid input', () => {
    assert.deepEqual(validateJson('{"a":1}'), { ok: true })
  })

  it('validateJson: unterminated input (no native position) maps to end-of-input line/column', () => {
    assert.deepEqual(validateJson('{"a":'), { ok: false, line: 1, column: 6, position: 5 })
  })

  it('validateJson: mid-stream token error carries the failing line/column on the right row', () => {
    assert.deepEqual(validateJson('{\n  "a": 1,\n  "b": }'), { ok: false, line: 3, column: 8, position: 19 })
  })

  it('validateJson: unexpected token without native position is located via the token', () => {
    assert.deepEqual(validateJson('not json'), { ok: false, line: 1, column: 2, position: 1 })
  })

  it('validateJson: trailing garbage after a valid document is flagged at the garbage position', () => {
    assert.deepEqual(validateJson('{"a":1}]'), { ok: false, line: 1, column: 8, position: 7 })
  })
})

describe('json CLI', () => {
  it('format reads stdin and pretty-prints, exit 0', () => {
    const r = runCli(['json', 'format'], { input: '{"b":1,"a":[1,2]}' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.equal(r.stdout, '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n')
  })

  it('minify reads stdin and compacts, exit 0', () => {
    const r = runCli(['json', 'minify'], { input: '{ "a" : 1 }' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '{"a":1}\n')
    assert.equal(r.stderr, '')
  })

  it('minify treats a lone "-" as stdin', () => {
    const r = runCli(['json', 'minify', '-'], { input: '{"x":1}' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '{"x":1}\n')
  })

  it('validate failure: exit 2, empty stdout, stderr names line and column (no stack frames)', () => {
    const r = runCli(['json', 'validate'], { input: '{"a":' })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /line 1, column 6/)
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'stderr must not contain stack frames')
    assert.doesNotMatch(r.stderr, /node:internal|file:\/\//, 'stderr must not contain module paths')
  })

  it('validate success confirms with "valid JSON" on stdout, exit 0', () => {
    const r = runCli(['json', 'validate'], { input: '{"a":1}' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, 'valid JSON\n')
    assert.equal(r.stderr, '')
  })

  it('unknown action is a usage error (exit 1, empty stdout)', () => {
    const r = runCli(['json', 'frobnicate'], { input: '{}' })
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /unknown json action/)
  })

  it('format reads a positional file, exit 0', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'data.json', '{"a":1}')
      const r = runCli(['json', 'format', f])
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '{\n  "a": 1\n}\n')
    } finally {
      await cleanup(dir)
    }
  })

  it('minify reads from -i/--input, exit 0', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'b.json', '{ "b" : 2 }')
      const r = runCli(['json', 'minify', '-i', f])
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '{"b":2}\n')
    } finally {
      await cleanup(dir)
    }
  })

  it('missing file: exit 2, empty stdout, stderr names the path', async () => {
    const dir = await makeTempDir()
    try {
      const r = runCli(['json', 'format', `${dir}/nope.json`])
      assert.equal(r.status, 2)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /nope\.json/)
      assert.doesNotMatch(r.stderr, /^\s+at /m)
    } finally {
      await cleanup(dir)
    }
  })

  it('positional file plus -i together is ambiguous (usage error, exit 1)', async () => {
    const dir = await makeTempDir()
    try {
      const f = await writeTempFile(dir, 'a.json', '{"a":1}')
      const r = runCli(['json', 'minify', f, '-i', f])
      assert.equal(r.status, 1)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /ambiguous/)
    } finally {
      await cleanup(dir)
    }
  })

  it('missing input on a TTY stdin raises UsageError (exit 1 taxonomy)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    try {
      await assert.rejects(readInput(undefined), (err: unknown) => {
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