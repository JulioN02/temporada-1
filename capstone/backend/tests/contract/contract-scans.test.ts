import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Cross-cutting contract scans (T-6-5). Cumulative gates:
 * - R-NFR-3: strict tsconfig flags + EVERY spec requirement ID appears in ≥1
 *   test name (63 IDs — the authoritative spec list).
 * - R-NFR-4: controllers contain no SQL/db access; services import no
 *   express/pg at runtime (type-only imports are erased and allowed).
 * - R-DOC-2: no hand-written OpenAPI file under src/ (generated at runtime).
 */

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function walk(dir: string, filter: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full, filter)
    return filter(entry) ? [full] : []
  })
}

/** The full v1 requirement set (spec.md — 63 requirements). */
const ALL_REQUIREMENT_IDS = [
  'R-AUD-1', 'R-AUD-2', 'R-AUD-3', 'R-AUD-4',
  'R-AUTH-1', 'R-AUTH-2', 'R-AUTH-3', 'R-AUTH-4', 'R-AUTH-5', 'R-AUTH-6', 'R-AUTH-7', 'R-AUTH-8',
  'R-CRM-1', 'R-CRM-2', 'R-CRM-3', 'R-CRM-4', 'R-CRM-5',
  'R-DOC-1', 'R-DOC-2',
  'R-JOB-1', 'R-JOB-2', 'R-JOB-3', 'R-JOB-4', 'R-JOB-5', 'R-JOB-6',
  'R-NFR-1', 'R-NFR-2', 'R-NFR-3', 'R-NFR-4', 'R-NFR-5', 'R-NFR-6',
  'R-NOT-1', 'R-NOT-2', 'R-NOT-3', 'R-NOT-4', 'R-NOT-5', 'R-NOT-6',
  'R-OBS-1', 'R-OBS-2', 'R-OBS-3',
  'R-ORD-1', 'R-ORD-2', 'R-ORD-3', 'R-ORD-4', 'R-ORD-5', 'R-ORD-6', 'R-ORD-7',
  'R-PROD-1', 'R-PROD-2', 'R-PROD-3', 'R-PROD-4', 'R-PROD-5', 'R-PROD-6', 'R-PROD-7', 'R-PROD-8',
  'R-STK-1', 'R-STK-2', 'R-STK-3', 'R-STK-4', 'R-STK-5', 'R-STK-6', 'R-STK-7', 'R-STK-8',
] as const

describe('R-NFR-3 quality gate (T-6-5)', () => {
  it('R-NFR-3: tsconfig enables the strict contract (noUncheckedIndexedAccess, exactOptionalPropertyTypes, erasableSyntaxOnly)', () => {
    const tsconfig = readFileSync(path.join(BACKEND, 'tsconfig.json'), 'utf8')
    const parsed = JSON.parse(tsconfig) as { compilerOptions: Record<string, unknown> }
    const opts = parsed.compilerOptions
    assert.equal(opts['strict'], true)
    assert.equal(opts['noUncheckedIndexedAccess'], true)
    assert.equal(opts['exactOptionalPropertyTypes'], true)
    assert.equal(opts['erasableSyntaxOnly'], true)
    assert.equal(opts['noEmit'], true)
  })

  it('R-NFR-3: every spec requirement ID (63) appears in at least one test name', () => {
    const testFiles = walk(path.join(BACKEND, 'tests'), (name) => name.endsWith('.test.ts'))
    assert.ok(testFiles.length >= 10, 'suite must contain multiple test files')
    const found = new Set<string>()
    for (const file of testFiles) {
      const source = readFileSync(file, 'utf8')
      // Requirement IDs must appear in a test NAME — it() and describe()
      // names both count (describe blocks group requirement-referenced tests).
      for (const match of source.matchAll(/(?:it|describe)\(\s*['"]([^'"]*R-[A-Z]+-\d+[^'"]*)['"]/g)) {
        for (const id of match[1]!.matchAll(/\bR-[A-Z]+-\d+\b/g)) found.add(id[0]!)
      }
    }
    const missing = ALL_REQUIREMENT_IDS.filter((id) => !found.has(id))
    assert.deepEqual(missing, [], `every requirement must have a test named with its ID (missing: ${missing.join(', ')})`)
  })
})

describe('R-NFR-4 architecture constraints (T-6-5)', () => {
  it('R-NFR-4: controllers contain no SQL and no db.query calls', () => {
    const offenders: string[] = []
    const sqlPattern = /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i
    for (const file of walk(path.join(BACKEND, 'src/modules'), (name) => name === 'controller.ts')) {
      const stripped = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/\/\/.*$/gm, '') // line comments
      if (sqlPattern.test(stripped) || /\.query\s*\(/.test(stripped)) {
        offenders.push(path.relative(BACKEND, file))
      }
    }
    assert.deepEqual(offenders, [], 'controllers must be orchestration-only (R-NFR-4)')
  })

  it('R-NFR-4: services import no express/pg at runtime (type-only imports allowed)', () => {
    const offenders: string[] = []
    for (const file of walk(path.join(BACKEND, 'src/modules'), (name) => name === 'service.ts')) {
      const source = readFileSync(file, 'utf8')
      for (const line of source.split('\n')) {
        if (/^import\s+(?!type\b)/.test(line.trim()) && /from\s+['"](express|pg)['"]/.test(line)) {
          offenders.push(`${path.relative(BACKEND, file)}: ${line.trim()}`)
        }
      }
    }
    assert.deepEqual(offenders, [], 'services must be framework-independent (R-NFR-4)')
  })
})

describe('R-DOC-2 no hand-written OpenAPI (T-6-5)', () => {
  it('R-DOC-2: no static openapi.json or swagger.json source file exists under src/', () => {
    const offenders = walk(path.join(BACKEND, 'src'), (name) =>
      /^(openapi|swagger)\.json$/.test(name),
    )
    assert.deepEqual(offenders, [], 'OpenAPI must be derived at runtime, never hand-written (R-DOC-2)')
  })
})