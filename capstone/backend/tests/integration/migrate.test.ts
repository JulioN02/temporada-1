import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts'
import { createPool } from '../../src/db/pool.ts'
import type { Pool } from 'pg'

/**
 * F-4 RED: `migrate --db=test` is idempotent — running it twice applies each
 * migration exactly once (ledger table `_migrations`). Also proves the runner
 * leaves a migrated schema behind (tables exist after first run).
 */
function runMigrate(): { status: number | null; stderr: string } {
  const res = spawnSync(process.execPath, ['scripts/migrate.ts', '--db=test'], {
    encoding: 'utf8',
    cwd: new URL('../..', import.meta.url).pathname,
  })
  return { status: res.status, stderr: res.stderr }
}

describe('migrate script (F-4, T-1-1)', () => {
  it('applies migrations and the ledger records each file once across two runs', async () => {
    const first = runMigrate()
    assert.equal(first.status, 0, `first migrate failed: ${first.stderr}`)
    const second = runMigrate()
    assert.equal(second.status, 0, `second migrate failed: ${second.stderr}`)

    const pool: Pool = createPool(testDatabaseUrl())
    try {
      const { rows } = await pool.query('SELECT name FROM _migrations ORDER BY name')
      const names = rows.map((r: { name: string }) => r.name)
      // Exactly one ledger row per migration file (no duplicates from run #2).
      assert.ok(names.length >= 2, `expected >=2 migrations, got ${JSON.stringify(names)}`)
      const unique = new Set(names)
      assert.equal(unique.size, names.length, 'ledger must not contain duplicates')
      // Seeded schema present after migrate.
      const tables = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('users','roles','permissions','user_roles','refresh_tokens','audit_log')`,
      )
      assert.ok(tables.rows.length >= 5, `expected core tables, got ${JSON.stringify(tables.rows)}`)
    } finally {
      await pool.end()
    }
  })
})

describe('migration 002_crm (T-2-1)', () => {
  it('R-CRM-1: duplicate email rejected at the DB (CITEXT unique) — case-insensitive', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool) // self-contained: the test DB persists across runs
      await pool.query(`INSERT INTO customers (name, email) VALUES ('Ana', 'dup@x.com')`)
      await assert.rejects(
        pool.query(`INSERT INTO customers (name, email) VALUES ('Luis', 'DUP@X.COM')`),
        (err: unknown) => (err as { code?: string }).code === '23505',
        'CITEXT unique email must reject case-variant duplicates with 23505',
      )
    } finally {
      await pool.end()
    }
  })

  it('R-CRM-4: status CHECK constraint rejects unknown statuses', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      await assert.rejects(
        pool.query(`INSERT INTO customers (name, status) VALUES ('Luis', 'frozen')`),
        (err: unknown) => (err as { code?: string }).code === '23514',
        'status CHECK (active|inactive) must reject unknown values with 23514',
      )
    } finally {
      await pool.end()
    }
  })
})

describe('migration 004_stock + 005_notifications (T-4-1)', () => {
  it('creates movements table, stock_levels view and notifications table', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('movements', 'notifications')`,
      )
      const names = new Set(tables.rows.map((r: { table_name: string }) => r.table_name))
      assert.ok(names.has('movements'), 'movements table must exist')
      assert.ok(names.has('notifications'), 'notifications table must exist')
      const view = await pool.query(`SELECT to_regclass('public.stock_levels') AS v`)
      assert.ok((view.rows[0] as { v: string | null }).v, 'stock_levels view must exist')
    } finally {
      await pool.end()
    }
  })

  it('R-STK-1: movements CHECK constraints — unknown type and sign rejected (23514)', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      const product = await pool.query(`INSERT INTO products (name, sku) VALUES ('Mv P', 'MV-P') RETURNING id`)
      const warehouse = await pool.query(`INSERT INTO warehouses (name) VALUES ('Mv WH') RETURNING id`)
      const pid = String(product.rows[0]!.id)
      const wid = String(warehouse.rows[0]!.id)
      // Unknown movement type → CHECK violation.
      await assert.rejects(
        pool.query(
          `INSERT INTO movements (product_id, warehouse_id, type, quantity, sign, reason)
           VALUES ($1, $2, 'sale', 1, -1, 'x')`,
          [pid, wid],
        ),
        (err: unknown) => (err as { code?: string }).code === '23514',
        'movements type CHECK must reject unknown types',
      )
      // Sign/type incoherence (order_out with sign +1) → CHECK violation.
      await assert.rejects(
        pool.query(
          `INSERT INTO movements (product_id, warehouse_id, type, quantity, sign, reason)
           VALUES ($1, $2, 'order_out', 1, 1, 'x')`,
          [pid, wid],
        ),
        (err: unknown) => (err as { code?: string }).code === '23514',
        'sign/type coherence CHECK must reject order_out with sign +1',
      )
      // quantity must be > 0.
      await assert.rejects(
        pool.query(
          `INSERT INTO movements (product_id, warehouse_id, type, quantity, sign, reason)
           VALUES ($1, $2, 'adjustment', 0, 1, 'x')`,
          [pid, wid],
        ),
        (err: unknown) => (err as { code?: string }).code === '23514',
        'quantity > 0 CHECK must reject zero',
      )
    } finally {
      await pool.end()
    }
  })

  it('R-STK-6: movements idempotency_key UNIQUE rejects duplicates (23505)', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      const product = await pool.query(`INSERT INTO products (name, sku) VALUES ('Mv P2', 'MV-P2') RETURNING id`)
      const warehouse = await pool.query(`INSERT INTO warehouses (name) VALUES ('Mv WH2') RETURNING id`)
      const pid = String(product.rows[0]!.id)
      const wid = String(warehouse.rows[0]!.id)
      const insert = `INSERT INTO movements (product_id, warehouse_id, type, quantity, sign, reason, idempotency_key)
                      VALUES ($1, $2, 'adjustment', 1, 1, 'some reason', 'k-1')`
      await pool.query(insert, [pid, wid])
      await assert.rejects(
        pool.query(insert, [pid, wid]),
        (err: unknown) => (err as { code?: string }).code === '23505',
        'idempotency_key UNIQUE must reject the same key twice',
      )
    } finally {
      await pool.end()
    }
  })

  it('R-NOT-2: notifications UNIQUE(type, reference, channel, user_id) — dup per recipient blocked, multi-recipient allowed', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      const user = await pool.query(
        `INSERT INTO users (username, email, password_hash) VALUES ('notif-u', 'notif@x.local', 'x') RETURNING id`,
      )
      const user2 = await pool.query(
        `INSERT INTO users (username, email, password_hash) VALUES ('notif-u2', 'notif2@x.local', 'x') RETURNING id`,
      )
      const uid = String(user.rows[0]!.id)
      const uid2 = String(user2.rows[0]!.id)
      const insert = `INSERT INTO notifications (user_id, type, channel, title, body, reference)
                      VALUES ($1, 'order_confirmed', 'in_app', 't', 'b', 'order:1')`
      await pool.query(insert, [uid])
      await assert.rejects(
        pool.query(insert, [uid]),
        (err: unknown) => (err as { code?: string }).code === '23505',
        'UNIQUE(type, reference, channel, user_id) must reject the same row twice',
      )
      // Same type+reference+channel but DIFFERENT user → allowed (rows are per
      // recipient — low_stock targets manager+operator, R-NOT-1 owner scope).
      await pool.query(insert, [uid2])
      // Same type+reference but different channel → allowed (matrix: both channels).
      await pool.query(
        `INSERT INTO notifications (user_id, type, channel, title, body, reference)
         VALUES ($1, 'order_confirmed', 'email', 't', 'b', 'order:1')`,
        [uid],
      )
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications`)
      assert.equal(rows[0]!.n, 3)
    } finally {
      await pool.end()
    }
  })
})

describe('migration 003_orders + 004_stock partial (T-3-1)', () => {
  /** Seeds a user + customer + product so order FK targets exist. */
  async function seedOrderRefs(pool: Pool): Promise<{ customerId: string; productId: string; userId: string }> {
    const user = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('t31u', 't31u@x.local', 'x') RETURNING id`,
    )
    const customer = await pool.query(
      `INSERT INTO customers (name, email) VALUES ('T31 Customer', 't31c@x.local') RETURNING id`,
    )
    const product = await pool.query(
      `INSERT INTO products (name, sku) VALUES ('T31 Product', 'T31-SKU') RETURNING id`,
    )
    return {
      userId: String(user.rows[0]!.id),
      customerId: String(customer.rows[0]!.id),
      productId: String(product.rows[0]!.id),
    }
  }

  it('R-ORD-1: order_items FK rejects an unknown product (23503)', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      const refs = await seedOrderRefs(pool)
      const order = await pool.query(
        `INSERT INTO orders (customer_id, total, created_by) VALUES ($1, '1.00', $2) RETURNING id`,
        [refs.customerId, refs.userId],
      )
      await assert.rejects(
        pool.query(
          `INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, line_total)
           VALUES ($1, 999999, 'ghost', 'GHOST', 1, '1.00', '1.00')`,
          [String(order.rows[0]!.id)],
        ),
        (err: unknown) => (err as { code?: string }).code === '23503',
        'order_items.product_id FK must reject unknown products with 23503',
      )
    } finally {
      await pool.end()
    }
  })

  it('R-ORD-3: orders state CHECK rejects unknown states; valid line insert succeeds', async () => {
    const pool: Pool = createPool(testDatabaseUrl())
    try {
      await resetDatabase(pool)
      const refs = await seedOrderRefs(pool)
      const order = await pool.query(
        `INSERT INTO orders (customer_id, total, created_by) VALUES ($1, '2.00', $2) RETURNING id`,
        [refs.customerId, refs.userId],
      )
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, line_total)
         VALUES ($1, $2, 'T31 Product', 'T31-SKU', 2, '1.00', '2.00')`,
        [String(order.rows[0]!.id), refs.productId],
      )
      await assert.rejects(
        pool.query(`UPDATE orders SET state = 'frozen' WHERE id = $1`, [String(order.rows[0]!.id)]),
        (err: unknown) => (err as { code?: string }).code === '23514',
        'orders state CHECK (draft|confirmed|cancelled) must reject unknown states',
      )
    } finally {
      await pool.end()
    }
  })
})