import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { uuidV4, uuidV7 } from '../src/core/uuid.ts'
import { runCli } from './helpers/exec.ts'

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** First 12 hex chars of a v7 UUID = the 48-bit ms timestamp (hyphen-aware). */
function tsPrefix(u: string): string {
  return u.slice(0, 8) + u.slice(9, 13)
}

/** Assert a sequence is non-decreasing in byte (string) order — UUID byte order == chronological order. */
function assertNonDecreasing(values: string[], label: string): void {
  for (let i = 1; i < values.length; i++) {
    assert.ok(
      values[i]! >= values[i - 1]!,
      `${label}: value #${i} (${values[i]}) < #${i - 1} (${values[i - 1]})`,
    )
  }
}

/** stderr must carry a clean error message — never an unhandled-exception stack trace. */
function assertGracefulError(stderr: string): void {
  assert.notEqual(stderr, '')
  assert.doesNotMatch(stderr, /^\s+at /m, 'stderr must not contain stack frames')
  assert.doesNotMatch(stderr, /node:internal|file:\/\//, 'stderr must not contain module paths')
}

// NOTE: core/uuid.ts keeps module-level monotonic state, so fake clocks across
// tests must be strictly increasing (a clock going backward is absorbed by the
// monotonic counter by design, which would break per-test expectations).
const CLOCK_1 = 1_700_000_000_000 // 018bcfe56800
const CLOCK_2 = 1_701_000_000_000 // 018c0b803200
const CLOCK_3 = 1_702_000_000_000 // 018c471afc00
const CLOCK_4 = 1_703_000_000_000 // 018c82b5c600
const CLOCK_5 = 1_704_000_000_000 // 018cbe509000

describe('core/uuid unit', () => {
  it('v4: canonical lowercase RFC 4122 shape with version 4 and variant 10xx', () => {
    const u = uuidV4()
    assert.match(u, V4_RE)
    assert.equal(u, u.toLowerCase())
    // first char of the variant group must be 8..b (variant bits 10)
    assert.match(u[19]!, /[89ab]/)
  })

  it('v4: 100 calls yield 100 distinct values', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(uuidV4())
    assert.equal(seen.size, 100)
  })

  it('v7: format matches RFC 9562 layout (ts + ver 7 + counter + variant)', () => {
    const u = uuidV7(() => CLOCK_1)
    assert.match(u, V7_RE)
    // first 12 hex chars are the 48-bit ms timestamp
    assert.equal(tsPrefix(u), '018bcfe56800') // 1700000000000 ms in hex
    // hex chars 14-16 are the 12-bit counter
    assert.match(u.slice(14, 17), /^[0-9a-f]{3}$/)
  })

  it('v7: 1000 calls on the same fake clock ms are unique and non-decreasing', () => {
    const values: string[] = []
    for (let i = 0; i < 1000; i++) values.push(uuidV7(() => CLOCK_2))
    assert.equal(new Set(values).size, 1000)
    assertNonDecreasing(values, 'same-ms')
    // The counter starts at a RANDOM value (0..4095), so a 1000-call burst can
    // cross the 4095 boundary and virtually advance the ms by 1 (~24% worst
    // case). The deterministic invariant: every prefix is the clock ms or the
    // virtually advanced ms+1 — never anything else.
    const prefixes = new Set(values.map((v) => tsPrefix(v)))
    for (const p of prefixes) {
      assert.ok(p === '018c0b803200' || p === '018c0b803201', `unexpected prefix ${p}`)
    }
  })

  it('v7: new ms re-randomizes the counter and order stays non-decreasing across the boundary', () => {
    let fakeNow = CLOCK_3
    const u1 = uuidV7(() => fakeNow)
    fakeNow += 5
    const u2 = uuidV7(() => fakeNow)
    fakeNow += 5
    const values = [u1, u2]
    for (let i = 0; i < 100; i++) values.push(uuidV7(() => fakeNow))
    assertNonDecreasing(values, 'new-ms')
    // later value's 12-char ms prefix strictly greater than earlier one's
    assert.ok(tsPrefix(u2) > tsPrefix(u1))
  })

  it('v7: counter overflow advances the timestamp virtually (no busy-wait), still non-decreasing', () => {
    const initial = '018c82b5c600' // CLOCK_4
    const values: string[] = []
    // > 4096 same-ms slots forces the virtual ms advance within the loop
    for (let i = 0; i < 4200; i++) values.push(uuidV7(() => CLOCK_4))
    assert.equal(new Set(values).size, 4200)
    assertNonDecreasing(values, 'overflow')
    // the tail of the sequence must show the virtually advanced timestamp
    assert.ok(tsPrefix(values[values.length - 1]!) > initial)
    // and there must be exactly one advanced timestamp: now + 1 ms
    const advanced = [...new Set(values.map((v) => tsPrefix(v)))].filter((ts) => ts !== initial)
    assert.equal(advanced.length, 1)
    assert.equal(advanced[0], '018c82b5c601')
  })

  it('v7: timestamp between two calls >= 5 ms apart advances the ms prefix', () => {
    let fakeNow = CLOCK_5
    const first = uuidV7(() => fakeNow)
    fakeNow += 5
    const second = uuidV7(() => fakeNow)
    assert.ok(tsPrefix(second) > tsPrefix(first))
  })

  it('v7: default clock (Date.now) still yields valid format', () => {
    assert.match(uuidV7(), V7_RE)
  })
})

describe('uuid CLI', () => {
  it('jdev uuid: one v4 UUID line on stdout, exit 0', () => {
    const r = runCli(['uuid'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const lines = r.stdout.split('\n')
    assert.equal(lines.length, 2)
    assert.equal(lines[1], '')
    assert.match(lines[0] ?? '', V4_RE)
  })

  it('jdev uuid --v7 --count 1000: monotonic, unique sequence (in-process state)', () => {
    const r = runCli(['uuid', '--v7', '--count', '1000'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const values = r.stdout.split('\n').filter((l) => l !== '')
    assert.equal(values.length, 1000)
    assert.equal(new Set(values).size, 1000)
    for (const v of values) assert.match(v, V7_RE)
    assertNonDecreasing(values, 'cli-1000')
  })

  it('jdev uuid --v7: 10 CLI samples all match the v7 format (E2E smoke)', () => {
    for (let i = 0; i < 10; i++) {
      const r = runCli(['uuid', '--v7'])
      assert.equal(r.status, 0)
      assert.match(r.stdout.trim(), V7_RE)
      assert.equal(r.stdout.split('\n').length, 2)
    }
  })

  it('jdev uuid --count 5: exactly 5 v4 lines', () => {
    const r = runCli(['uuid', '--count', '5'])
    assert.equal(r.status, 0)
    const values = r.stdout.split('\n').filter((l) => l !== '')
    assert.equal(values.length, 5)
    for (const v of values) assert.match(v, V4_RE)
  })

  it('jdev uuid --v4 --v7: mutually exclusive options are a usage error (exit 1)', () => {
    const r = runCli(['uuid', '--v4', '--v7'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /mutually exclusive/)
    assertGracefulError(r.stderr)
  })

  it('jdev uuid --count 0 and --count abc are usage errors (exit 1)', () => {
    for (const bad of ['0', 'abc', '-3']) {
      const r = runCli(['uuid', '--count', bad])
      assert.equal(r.status, 1, `--count ${bad} must exit 1`)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /--count/)
      assertGracefulError(r.stderr)
    }
  })
})