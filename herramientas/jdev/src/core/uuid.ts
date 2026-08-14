import { randomBytes, randomUUID } from 'node:crypto'

/** RFC 4122 version 4 UUID from node:crypto (lowercase canonical). */
export function uuidV4(): string {
  return randomUUID()
}

const COUNTER_MASK = 0x0fff // 12-bit per-ms counter: 4096 slots per millisecond

// Module-level monotonic state (race-free under Node's single-threaded model).
let lastUnixTsMs = -1
let counter = 0

/**
 * RFC 9562 version 7 UUID with a monotonic per-ms counter:
 * - hex chars 1-12: 48-bit unix_ts_ms (canonical 8-4-4-4-12 hyphenation)
 * - hex char 13: version nibble (7)
 * - hex chars 14-16: 12-bit counter (random start per new ms)
 * - hex chars 17+: variant bits 10 + 62 random bits (crypto)
 * On counter overflow the timestamp advances VIRTUALLY by 1 ms
 * (lastUnixTsMs + 1, counter reset) — O(1), no busy-wait, no Atomics.
 * Byte order of the string == chronological order (ts dominates, then counter).
 * The `now` parameter is a test-only clock injection, defaulting to Date.now.
 */
export function uuidV7(now: () => number = Date.now): string {
  const raw = now()
  if (raw > lastUnixTsMs) {
    lastUnixTsMs = raw
    counter = randomBytes(2).readUInt16BE(0) & COUNTER_MASK
  } else {
    counter++
    if (counter > COUNTER_MASK) {
      lastUnixTsMs++
      counter = 0
    }
  }

  const rand = randomBytes(8)
  rand[0] = (rand[0]! & 0x3f) | 0x80 // variant 10xxxxxx → first rand hex char ∈ [89ab]

  const hex = `${lastUnixTsMs.toString(16).padStart(12, '0')}7${counter.toString(16).padStart(3, '0')}${rand.toString('hex')}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}