import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Evidence generator (F-9): runs the full test suite and appends suite counts
 * + requirement IDs to `docs/output-it<N>.txt` (R-PROD-6 convention).
 *
 * Usage: node scripts/evidence.ts <iteration>   e.g. node scripts/evidence.ts it1
 */
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = path.resolve(BACKEND_DIR, '../docs')

function main(): void {
  const iteration = process.argv[2]
  if (!iteration) {
    console.error('usage: node scripts/evidence.ts <iteration> (e.g. it1)')
    process.exit(1)
  }

  const suite = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', 'tests/**/*.test.ts'],
    { encoding: 'utf8', cwd: BACKEND_DIR },
  )
  const output = suite.stdout + suite.stderr

  const testsMatch = output.match(/ℹ tests\s+(\d+)/)
  const passMatch = output.match(/ℹ pass\s+(\d+)/)
  const failMatch = output.match(/ℹ fail\s+(\d+)/)
  const tests = testsMatch ? Number(testsMatch[1]) : -1
  const pass = passMatch ? Number(passMatch[1]) : -1
  const fail = failMatch ? Number(failMatch[1]) : -1

  const requirementIds = [...new Set(output.match(/\bR-[A-Z]+-\d+\b/g) ?? [])].sort()

  const section = [
    '',
    `=== Evidence ${iteration} — ${new Date().toISOString()} ===`,
    `Command: node --test --test-concurrency=1 "tests/**/*.test.ts"`,
    `Suite: ${tests} tests, ${pass} passed, ${fail} failed`,
    `Requirement IDs covered in test names (${requirementIds.length}):`,
    requirementIds.join(', '),
    '',
  ].join('\n')

  const target = path.join(DOCS_DIR, `output-${iteration}.txt`)
  mkdirSync(DOCS_DIR, { recursive: true })
  writeFileSync(target, readFileSync(target, 'utf8') + section)
  console.log(`Evidence appended to ${target}`)
  console.log(`${tests} tests, ${pass} passed, ${fail} failed | ${requirementIds.length} requirement IDs`)
  process.exit(fail > 0 ? 1 : 0)
}

main()