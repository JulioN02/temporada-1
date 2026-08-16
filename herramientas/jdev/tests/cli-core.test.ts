import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runCli } from './helpers/exec.ts'
import { cleanup, makeTempDir, writeTempFile } from './helpers/temp.ts'
import { JdevError, IoError, UsageError } from '../src/core/errors.ts'
import { readInput, resolveInput } from '../src/utils/io.ts'
import { shouldColor, writeStdout } from '../src/utils/output.ts'

/** Version from package.json — the CLI reads it at runtime, so do the tests. */
function readPkgVersion(): string {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
}

const COMMANDS = ['uuid', 'json', 'base64', 'timestamp', 'hash', 'password', 'jwt', 'csv', 'http', 'tui']
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ANSI_RE = /\x1b\[[0-9;]*m/

describe('cli-core spec scenarios', () => {
  it('help with no args lists the 10 subcommands and exits 0', () => {
    const r = runCli([])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    for (const name of COMMANDS) {
      assert.ok(r.stdout.includes(name), `help must list subcommand '${name}'`)
    }
  })

  it('unknown command: stderr error, empty stdout, exit 1', () => {
    // With a top-level action (no-args help), commander v15 reports naked operands
    // as excess arguments — same usage-error contract (exit 1), message names the input.
    const r = runCli(['frobnicate'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /unknown command|too many arguments/)
    assert.ok(r.stderr.includes('frobnicate'), `stderr must name the offending input, got: ${r.stderr}`)
  })

  it('missing required argument: usage error on stderr, exit 1', () => {
    const r = runCli(['jwt'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /required argument/)
  })

  it('runtime IO error: stderr error, empty stdout, exit 2', async () => {
    const dir = await makeTempDir()
    try {
      const missing = await writeTempFile(dir, 'placeholder', 'x')
      void missing
      const gone = `${dir}/missing.txt`
      const r = runCli(['hash', '--file', gone])
      assert.equal(r.status, 2)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /missing\.txt|cannot read|no such file/)
    } finally {
      await cleanup(dir)
    }
  })

  it('pipe discipline: stdout carries only the UUID line, exit 0', () => {
    const r = runCli(['uuid'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const lines = r.stdout.split('\n')
    assert.equal(lines.length, 2) // exactly one line + trailing newline, nothing else
    assert.equal(lines[1], '')
    assert.match(lines[0] ?? '', UUID_V4_RE)
  })

  it('NO_COLOR=1 disables ANSI escapes', () => {
    const r = runCli(['frobnicate'], { env: { NO_COLOR: '1' } })
    assert.equal(r.status, 1)
    assert.doesNotMatch(r.stderr, ANSI_RE)
  })

  it('FORCE_COLOR=1 forces ANSI on stderr diagnostics even when piped', () => {
    const r = runCli(['frobnicate'], { env: { FORCE_COLOR: '1' } })
    assert.equal(r.status, 1)
    assert.match(r.stderr, ANSI_RE)
    // data purity: stdout never carries ANSI
    assert.doesNotMatch(r.stdout, ANSI_RE)
    assert.equal(r.stdout, '')
  })

  it('stdin input: json minify reads piped stdin', () => {
    const r = runCli(['json', 'minify'], { input: '{"a":1}' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '{"a":1}\n')
    assert.equal(r.stderr, '')
  })

  it('--version prints the package.json version and exits 0', () => {
    const r = runCli(['--version'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), readPkgVersion())
    assert.equal(r.stderr, '')
  })

  it('json validate: confirms "valid JSON" on success, exit 2 with stderr on invalid input', () => {
    const ok = runCli(['json', 'validate'], { input: '{"a":1}', env: { LANG: 'en_US.UTF-8' } })
    assert.equal(ok.status, 0)
    assert.equal(ok.stdout, 'valid JSON\n')
    assert.equal(ok.stderr, '')
    const bad = runCli(['json', 'validate'], { input: '{"a":', env: { LANG: 'en_US.UTF-8' } })
    assert.equal(bad.status, 2)
    assert.equal(bad.stdout, '')
    assert.notEqual(bad.stderr, '')
    assert.doesNotMatch(bad.stderr, /^\s+at /m, 'stderr must not contain stack frames')
  })
})

describe('utils/output contract', () => {
  const saved = { no: process.env.NO_COLOR, force: process.env.FORCE_COLOR }

  // The color-policy tests assume a CLEAN environment: the shell that runs
  // the suite may export NO_COLOR or FORCE_COLOR (common in dotfiles), which
  // would otherwise leak into "neither variable is set" via afterEach's
  // restore. Clear both before EVERY test, not just after.
  beforeEach(() => {
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
  })

  afterEach(() => {
    if (saved.no === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = saved.no
    if (saved.force === undefined) delete process.env.FORCE_COLOR
    else process.env.FORCE_COLOR = saved.force
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true })
  })

  it('NO_COLOR wins over FORCE_COLOR and TTY', () => {
    process.env.NO_COLOR = '1'
    process.env.FORCE_COLOR = '1'
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    assert.equal(shouldColor(), false)
  })

  it('FORCE_COLOR forces color on non-TTY stdout', () => {
    process.env.FORCE_COLOR = '1'
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    assert.equal(shouldColor(), true)
  })

  it('defaults to stdout.isTTY when neither variable is set', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    assert.equal(shouldColor(), true)
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    assert.equal(shouldColor(), false)
  })

  it('writeStdout on a TTY appends a newline when the payload lacks one (visual ergonomics)', () => {
    let written = ''
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: string) => { written += s; return true }) as typeof process.stdout.write
    try {
      writeStdout('Hola mundo', true)
      assert.equal(written, 'Hola mundo\n')
      written = ''
      writeStdout('ya termina\n', true)
      assert.equal(written, 'ya termina\n', 'no duplicate newline when already present')
    } finally {
      process.stdout.write = orig
    }
  })

  it('writeStdout on a non-TTY writes bytes verbatim (binary purity preserved)', () => {
    let written = ''
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: string) => { written += s; return true }) as typeof process.stdout.write
    try {
      writeStdout('bytes-crudos', false)
      assert.equal(written, 'bytes-crudos', 'no newline added when piped')
      written = ''
      writeStdout('con\n', false)
      assert.equal(written, 'con\n')
    } finally {
      process.stdout.write = orig
    }
  })

  it('writeStdout on a TTY appends a raw 0x0a to Buffer payloads (binary decode ergonomics)', () => {
    const chunks: Buffer[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: string | Buffer) => { chunks.push(Buffer.isBuffer(s) ? s : Buffer.from(s)); return true }) as typeof process.stdout.write
    try {
      writeStdout(Buffer.from([0x48, 0x69]), true)
      assert.deepEqual(Buffer.concat(chunks), Buffer.from([0x48, 0x69, 0x0a]))
      chunks.length = 0
      writeStdout(Buffer.from([0x48, 0x69, 0x0a]), true)
      assert.deepEqual(Buffer.concat(chunks), Buffer.from([0x48, 0x69, 0x0a]), 'no duplicate newline byte')
    } finally {
      process.stdout.write = orig
    }
  })
})

describe('utils/io contract', () => {
  it('resolveInput rejects ambiguous positional + -i combination', () => {
    assert.throws(() => resolveInput('a.txt', 'b.txt'), UsageError)
  })

  it('resolveInput prefers positional or falls back to -i', () => {
    assert.equal(resolveInput('a.txt', undefined), 'a.txt')
    assert.equal(resolveInput(undefined, 'b.txt'), 'b.txt')
    assert.equal(resolveInput(undefined, undefined), undefined)
  })

  it('readInput on a missing file throws IoError (exit 2 taxonomy)', async () => {
    const dir = await makeTempDir()
    try {
      await assert.rejects(readInput(`${dir}/nope.txt`), (err: unknown) => {
        assert.ok(err instanceof IoError)
        assert.equal((err as JdevError).code, 'IO_READ')
        assert.equal((err as JdevError).exitCode, 2)
        return true
      })
    } finally {
      await cleanup(dir)
    }
  })

  it('readInput reads a real file as a Buffer', async () => {
    const dir = await makeTempDir()
    try {
      const path = await writeTempFile(dir, 'data.txt', 'hello\n')
      const buf = await readInput(path)
      assert.equal(buf.toString('utf8'), 'hello\n')
    } finally {
      await cleanup(dir)
    }
  })

  it('readInput with no file on a TTY stdin raises UsageError (missing input)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    await assert.rejects(readInput(undefined), UsageError)
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
  })
})