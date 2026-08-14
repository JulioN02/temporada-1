import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { epochMillis, epochSeconds, parseEpoch, toIsoLocal, toIsoUtc } from '../src/core/timestamp.ts'
import { TimestampError } from '../src/core/errors.ts'
import { runCli } from './helpers/exec.ts'

const EPOCH_MS = 1_710_000_000_000 // 2024-03-09T16:00:00.000Z
const BA_TZ = 'America/Argentina/Buenos_Aires' // UTC-3, no DST

describe('core/timestamp unit', () => {
  it('epochSeconds floors Date.now()/1000', () => {
    assert.equal(epochSeconds(() => EPOCH_MS), 1_710_000_000)
  })

  it('epochMillis returns the raw millisecond value', () => {
    assert.equal(epochMillis(() => EPOCH_MS), EPOCH_MS)
  })

  it('toIsoUtc emits millisecond-precision UTC ISO', () => {
    assert.equal(toIsoUtc(EPOCH_MS), '2024-03-09T16:00:00.000Z')
  })

  it('toIsoLocal appends the numeric local offset (UTC-3 pinned)', () => {
    const saved = process.env.TZ
    try {
      process.env.TZ = BA_TZ
      assert.equal(toIsoLocal(EPOCH_MS), '2024-03-09T13:00:00.000-03:00')
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })

  it('toIsoLocal in UTC appends +00:00 and keeps the same wall time', () => {
    const saved = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      assert.equal(toIsoLocal(EPOCH_MS), '2024-03-09T16:00:00.000+00:00')
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })

  it('parseEpoch accepts non-negative integers only; anything else is a TimestampError (exit 2)', () => {
    assert.equal(parseEpoch('1710000000'), 1_710_000_000)
    assert.equal(parseEpoch('0'), 0)
    for (const bad of ['abc', '-5', '1.5', ' 1710000000', '1710000000\n', '1e9']) {
      assert.throws(() => parseEpoch(bad), (err: unknown) => {
        assert.ok(err instanceof TimestampError)
        assert.equal((err as TimestampError).code, 'INVALID_EPOCH')
        assert.equal((err as TimestampError).exitCode, 2)
        return true
      }, `expected TimestampError for ${JSON.stringify(bad)}`)
    }
  })
})

describe('timestamp CLI', () => {
  it('default output is the seconds epoch within +/- 5 s of now', () => {
    const r = runCli(['timestamp'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.match(r.stdout, /^\d{10}\n$/)
    const value = Number(r.stdout.trim())
    assert.ok(Math.abs(value - Date.now() / 1000) <= 5, `epoch ${value} out of tolerance`)
  })

  it('--ms output is the milliseconds epoch within +/- 5000 ms of now', () => {
    const r = runCli(['timestamp', '--ms'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^\d{13}\n$/)
    const value = Number(r.stdout.trim())
    assert.ok(Math.abs(value - Date.now()) <= 5000, `epoch ${value} out of tolerance`)
  })

  it('--iso prints an ISO 8601 UTC timestamp corresponding to now', () => {
    const r = runCli(['timestamp', '--iso'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/)
    const parsed = Date.parse(r.stdout.trim())
    assert.ok(Math.abs(parsed - Date.now()) <= 5000, `ISO ${r.stdout.trim()} out of tolerance`)
  })

  it('epoch conversion to ISO: seconds argument', () => {
    const r = runCli(['timestamp', '1710000000', '--iso'])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    assert.equal(r.stdout, '2024-03-09T16:00:00.000Z\n')
  })

  it('epoch conversion to ISO with --ms interprets the argument as milliseconds', () => {
    const r = runCli(['timestamp', '1710000000000', '--ms', '--iso'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '2024-03-09T16:00:00.000Z\n')
  })

  it('epoch conversion to local ISO pins the numeric offset (TZ=America/Argentina/Buenos_Aires)', () => {
    const r = runCli(['timestamp', '1710000000', '--iso', '--local'], { env: { TZ: BA_TZ } })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '2024-03-09T13:00:00.000-03:00\n')
  })

  it('bare epoch is echoed as digits (interpreted in the output unit: seconds)', () => {
    const r = runCli(['timestamp', '1710000000'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '1710000000\n')
  })

  it('epoch with --ms is echoed as digits (millisecond unit)', () => {
    const r = runCli(['timestamp', '1710000000000', '--ms'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '1710000000000\n')
  })

  it('invalid epoch: exit 2, empty stdout, clean stderr', () => {
    const r = runCli(['timestamp', 'abc'])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.notEqual(r.stderr, '')
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'stderr must not contain stack frames')
    assert.doesNotMatch(r.stderr, /node:internal|file:\/\//, 'stderr must not contain module paths')
  })

  it('--local without --iso is a usage error (exit 1)', () => {
    const r = runCli(['timestamp', '--local'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /--local requires --iso/)
  })
})