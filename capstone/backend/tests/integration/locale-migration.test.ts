import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { createTestPool } from '../helpers/db.ts'
import { resetDatabase } from '../helpers/db.ts'

/**
 * T-1-1 / capstone-ui it1 — R-BE-1: migration 007_locale.sql adds
 * `users.locale` + `notifications.locale` (TEXT NOT NULL DEFAULT 'es' CHECK
 * IN ('es','en')), additive + idempotent (ADD COLUMN IF NOT EXISTS). Safe
 * re-run, safe downgrade; existing rows default 'es'; rendered history
 * untouched.
 */

const SQL_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/db/sql/007_locale.sql',
)

function readMigration(): string {
  return readFileSync(SQL_FILE, 'utf8')
}

let pool: Pool

beforeEach(async () => {
  pool = createTestPool()
  await resetDatabase(pool)
})

afterEach(async () => {
  await pool.end()
})

describe('migration 007_locale (T-1-1, R-BE-1)', () => {
  it('R-BE-1: applies twice -> no-op; columns exist with NOT NULL, default es and CHECK (es|en)', async () => {
    const sql = readMigration()
    // Idempotent: running the file twice must not error (ADD COLUMN IF NOT EXISTS).
    await pool.query(sql)
    await pool.query(sql)

    for (const table of ['users', 'notifications']) {
      const cols = await pool.query(
        `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'locale'`,
        [table],
      )
      assert.equal(cols.rows.length, 1, `${table}.locale column must exist after 007`)
      const col = cols.rows[0] as {
        column_name: string
        is_nullable: string
        column_default: string
      }
      assert.equal(col.is_nullable, 'NO', `${table}.locale must be NOT NULL`)
      assert.equal(col.column_default, "'es'::text", `${table}.locale default must be 'es'`)
    }

    // CHECK constraint must accept exactly es|en (constraint exists on both tables).
    for (const table of ['users', 'notifications']) {
      const checks = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conrelid = $1::regclass AND contype = 'c'`,
        [table],
      )
      const defs = (checks.rows as Array<{ def: string }>).map((r) => r.def)
      const localeCheck = defs.find((d) => d.includes('locale'))
      assert.ok(localeCheck, `${table} must carry a CHECK on locale`)
      assert.ok(localeCheck!.includes("'es'") && localeCheck!.includes("'en'"), `${table} CHECK allows es|en`)
      assert.ok(!localeCheck!.includes("'fr'"), `${table} CHECK must not accept 'fr'`)
    }
  })

  it('R-BE-1: defaults — rows inserted without locale get es; existing values survive a re-run (history untouched)', async () => {
    // Pre-existing row BEFORE the migration content re-runs.
    const pre = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('pre-locale', 'pre@x.local', 'x') RETURNING id`,
    )
    const preUserId = String(pre.rows[0]!.id)

    // Re-apply the migration — must be a no-op that does NOT reset existing values.
    await pool.query(readMigration())
    await pool.query(`UPDATE users SET locale = 'en' WHERE id = $1`, [preUserId])
    await pool.query(readMigration())
    const after = await pool.query(`SELECT locale FROM users WHERE id = $1`, [preUserId])
    assert.equal(after.rows[0]!.locale, 'en', 're-running 007 must not reset an existing locale value')

    // Fresh rows default to 'es' on both tables.
    const user = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('fresh-locale', 'fresh@x.local', 'x') RETURNING id`,
    )
    const freshUserId = String(user.rows[0]!.id)
    const fresh = await pool.query(`SELECT locale FROM users WHERE id = $1`, [freshUserId])
    assert.equal(fresh.rows[0]!.locale, 'es', 'new user defaults to es')

    await pool.query(
      `INSERT INTO notifications (user_id, type, channel, title, body, reference)
       VALUES ($1, 'order_confirmed', 'in_app', 't', 'b', 'loc:1')`,
      [freshUserId],
    )
    const notif = await pool.query(`SELECT locale FROM notifications WHERE reference = 'loc:1'`)
    assert.equal(notif.rows[0]!.locale, 'es', 'new notification defaults to es')
  })

  it('R-BE-1: CHECK enforced — locale fr rejected on both tables (23514)', async () => {
    const user = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('check-locale', 'check@x.local', 'x') RETURNING id`,
    )
    const userId = String(user.rows[0]!.id)
    await assert.rejects(
      pool.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [userId]),
      (err: unknown) => (err as { code?: string }).code === '23514',
      'users.locale CHECK must reject fr with 23514',
    )
    await pool.query(
      `INSERT INTO notifications (user_id, type, channel, title, body, reference)
       VALUES ($1, 'low_stock', 'in_app', 't', 'b', 'loc:2')`,
      [userId],
    )
    await assert.rejects(
      pool.query(`UPDATE notifications SET locale = 'fr' WHERE reference = 'loc:2'`),
      (err: unknown) => (err as { code?: string }).code === '23514',
      'notifications.locale CHECK must reject fr with 23514',
    )
  })
})