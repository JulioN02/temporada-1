import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

/**
 * Idempotent SQL migration runner.
 *
 * - Applies `src/db/sql/NNN_name.sql` files in sorted order.
 * - Tracks applied files in the `_migrations` ledger table; re-running is a
 *   no-op for already-applied files (F-4: migrate twice → second no-op).
 * - Each file runs inside its own transaction (all-or-nothing per file).
 * - `--db=test` targets the test database (bop_test), `--db=dev` the dev DB.
 */
const SQL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/sql')

function resolveUrl(target?: string): string {
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55437/bop',
  )
  if (target) url.pathname = `/${target}`
  return url.toString()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbFlag = args.find((a) => a.startsWith('--db='))?.split('=')[1]
  const target = dbFlag === 'test' ? 'bop_test' : dbFlag === 'dev' ? 'bop' : undefined

  const files = readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const client = new Client({ connectionString: resolveUrl(target) })
  await client.connect()
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    let applied = 0
    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file])
      if (rows.length > 0) continue // idempotent — already applied
      const sql = readFileSync(path.join(SQL_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Applied ${file}`)
        applied += 1
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    console.log(
      `Migration complete (${files.length} files, ${applied} newly applied) → ${target ?? 'DATABASE_URL'}`,
    )
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})