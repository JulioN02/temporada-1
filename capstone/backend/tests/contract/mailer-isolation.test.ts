import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * R-NOT-3 contract: SMTP lives EXCLUSIVELY in the worker. The request path
 * (modules/) must never import the mailer or nodemailer — enqueuing a job is
 * the only allowed side effect (ADR-13, design §9). Static scan over src/.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return tsFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('R-NOT-3 mailer isolation (T-5-3)', () => {
  it('R-NOT-3: no src/modules file imports jobs/mailer or nodemailer (request path never sends)', () => {
    const offenders: string[] = []
    for (const file of tsFiles(path.join(SRC, 'modules'))) {
      const source = readFileSync(file, 'utf8')
      if (/from ['"].*jobs\/mailer['"]|require\(['"].*nodemailer['"]\)|from ['"]nodemailer['"]/.test(source)) {
        offenders.push(path.relative(SRC, file))
      }
    }
    assert.deepEqual(offenders, [], 'modules must never import the mailer')
  })

  it('R-NOT-3: nodemailer is imported by exactly one file — jobs/mailer.ts', () => {
    const importers: string[] = []
    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      if (/from ['"]nodemailer['"]/.test(source)) {
        importers.push(path.relative(SRC, file))
      }
    }
    assert.deepEqual(importers, ['jobs/mailer.ts'], 'only the mailer module may import nodemailer')
  })
})