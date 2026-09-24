import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * R-NOT-6 contract: notifications are EVENT-DRIVEN — raised inside the domain
 * transaction (ADR-2 same-tx enqueue, SPIKE-validated) — NEVER polled. This
 * scan enforces the "no polling" half: application code in src/ must not
 * contain polling loops, cron expressions or interval timers. (pg-boss's own
 * internal polling lives in node_modules, and the WORKER consumes jobs via the
 * pg-boss `work()` API — neither is application polling.)
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return tsFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('R-NOT-6 no-polling scan (T-5-10)', () => {
  it('R-NOT-6: src/ contains no polling loops, interval timers or cron expressions', () => {
    const offenders: Array<{ file: string; match: string }> = []
    const patterns = [
      /setInterval\s*\(/,
      /setTimeout\s*\(\s*[^,]+,\s*[^)]*\)\s*;\s*(?!\n)/,
      /cron\s*['"]/i,
      /LISTEN\s+['"]/i,
      /pg_notify/i,
    ]
    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of patterns) {
        const match = source.match(pattern)
        if (match) {
          offenders.push({ file: path.relative(SRC, file), match: match[0]! })
        }
      }
    }
    assert.deepEqual(offenders, [], 'no polling constructs in application code')
  })
})