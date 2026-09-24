import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Contract scans (T-1-7 early port; the full contract-scan suite completes at
 * T-6-5). Source-scan tests keep secrets and verification discipline honest.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return allSourceFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('security scans (T-1-7, R-NFR-2/R-NFR-5)', () => {
  it('R-NFR-2: no hardcoded secret literals in src/ (env-only secrets)', () => {
    const secretPattern = /(?:JWT_SECRET|COOKIE_SECRET|SMTP_PASS|DATABASE_URL)\s*=\s*['"][^'"]+['"]/
    const offenders: string[] = []
    for (const file of allSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8')
      const match = content.match(secretPattern)
      if (match) offenders.push(`${file}: ${match[0]}`)
    }
    assert.deepEqual(offenders, [], 'secrets must come from validated env only (R-NFR-2)')
  })

  it('R-NFR-5: jwt.decode is never used in src/ (verify-only discipline)', () => {
    const offenders: string[] = []
    for (const file of allSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8')
      if (content.includes('jwt.decode(')) offenders.push(file)
    }
    assert.deepEqual(offenders, [], 'access tokens must be verified with jwt.verify, never decoded alone (R-NFR-5)')
  })

  it('R-NFR-5: refresh token hashing uses SHA-256 in the auth module', () => {
    const authService = readFileSync(path.join(SRC_DIR, 'modules/auth/service.ts'), 'utf8')
    assert.match(authService, /createHash\('sha256'\)/, 'sha256 hex helper required for refresh hashing')
  })
})