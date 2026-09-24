import type { Db } from '../../db/pool.ts'
import type { MovementType } from './dto.ts'

/**
 * Stock repository (T-3-6 catalog + T-4-2 ledger) — the ONLY DB access for
 * stock. All SQL parameterized (R-NFR-1). Movement writes run under
 * `pg_advisory_xact_lock` keyed on the product (design §6/§7 — ascending id
 * order, deadlock-free); levels are read via the derived `stock_levels` view
 * / inline SUM inside the same tx (sees uncommitted rows).
 */

export interface ProductRecord {
  id: string
  name: string
  sku: string
  low_stock_threshold: number
  active: boolean
  created_at: Date
  updated_at: Date
}

export interface WarehouseRecord {
  id: string
  name: string
  created_at: Date
}

export interface MovementRecord {
  id: string // BIGSERIAL → string (pg int8)
  product_id: string
  warehouse_id: string
  type: MovementType
  quantity: number
  sign: number
  reason: string
  idempotency_key: string | null
  created_at: Date
}

export interface MovementInsertInput {
  productId: string
  warehouseId: string
  type: MovementType
  quantity: number
  sign: number
  reason: string
  idempotencyKey: string | null
}

/** Movement + catalog names for GET /api/stock/movements (R-STK-8). */
export interface MovementListRecord extends MovementRecord {
  sku: string
  product_name: string
  warehouse_name: string
}

export interface MovementListResult {
  items: MovementListRecord[]
  total: number
}

/** Product reference + threshold for the low-stock choke (ADR-5). */
export interface MovementProductRef {
  id: string
  name: string
  sku: string
  low_stock_threshold: number
  active: boolean
}

export interface StockRow {
  product_id: string
  sku: string
  name: string
  warehouse_id: string
  warehouse_name: string
  level: string
}

const MOVEMENT_COLUMNS =
  'id, product_id, warehouse_id, type, quantity, sign, reason, idempotency_key, created_at'

export async function insertProduct(
  db: Db,
  input: { name: string; sku: string; lowStockThreshold: number },
): Promise<ProductRecord> {
  const { rows } = await db.query(
    `INSERT INTO products (name, sku, low_stock_threshold)
     VALUES ($1, $2, $3)
     RETURNING id, name, sku, low_stock_threshold, active, created_at, updated_at`,
    [input.name, input.sku, input.lowStockThreshold],
  )
  return rows[0] as ProductRecord
}

export interface ProductListResult {
  items: ProductRecord[]
  total: number
}

/** q matches name/sku case-insensitively (substring); 2 queries (count + data). */
export async function listProducts(
  db: Db,
  opts: { q?: string | undefined; page: number; pageSize: number },
): Promise<ProductListResult> {
  const where: string[] = []
  const values: unknown[] = []
  if (opts.q) {
    values.push(`%${opts.q}%`)
    values.push(`%${opts.q}%`)
    where.push(`(name ILIKE $${values.length - 1} OR sku ILIKE $${values.length})`)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (opts.page - 1) * opts.pageSize

  const count = await db.query(`SELECT COUNT(*)::int AS total FROM products ${whereSql}`, values)
  const data = await db.query(
    `SELECT id, name, sku, low_stock_threshold, active, created_at, updated_at
     FROM products ${whereSql}
     ORDER BY id
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, opts.pageSize, offset],
  )
  return {
    items: data.rows as ProductRecord[],
    total: (count.rows[0] as { total: number }).total,
  }
}

export async function insertWarehouse(db: Db, name: string): Promise<WarehouseRecord> {
  const { rows } = await db.query(
    `INSERT INTO warehouses (name) VALUES ($1) RETURNING id, name, created_at`,
    [name],
  )
  return rows[0] as WarehouseRecord
}

/* ------------------- it1 delta: products PATCH + warehouses CRUD ------------------- */

export interface UpdateProductInput {
  // `| undefined` required: the service passes the zod-inferred input through
  // (exactOptionalPropertyTypes).
  name?: string | undefined
  sku?: string | undefined
  lowStockThreshold?: number | undefined
  active?: boolean | undefined
}

/** R-UI-CRM-7: PATCH product — dynamic SET (at least one field, DTO-refined). */
export async function updateProduct(
  db: Db,
  id: string,
  input: UpdateProductInput,
): Promise<ProductRecord | null> {
  const sets: string[] = ['updated_at = now()']
  const values: unknown[] = []
  if (input.name !== undefined) {
    values.push(input.name)
    sets.push(`name = $${values.length}`)
  }
  if (input.sku !== undefined) {
    values.push(input.sku)
    sets.push(`sku = $${values.length}`)
  }
  if (input.lowStockThreshold !== undefined) {
    values.push(input.lowStockThreshold)
    sets.push(`low_stock_threshold = $${values.length}`)
  }
  if (input.active !== undefined) {
    values.push(input.active)
    sets.push(`active = $${values.length}`)
  }
  values.push(id)
  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${values.length}
     RETURNING id, name, sku, low_stock_threshold, active, created_at, updated_at`,
    values,
  )
  return (rows[0] as ProductRecord | undefined) ?? null
}

export interface WarehouseListResult {
  items: WarehouseRecord[]
  total: number
}

/** R-UI-CRM-8: GET /api/warehouses — paginated list (stock:stock_read pickers). */
export async function listWarehouses(
  db: Db,
  opts: { page: number; pageSize: number },
): Promise<WarehouseListResult> {
  const offset = (opts.page - 1) * opts.pageSize
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM warehouses`)
  const data = await db.query(
    `SELECT id, name, created_at FROM warehouses ORDER BY id LIMIT $1 OFFSET $2`,
    [opts.pageSize, offset],
  )
  return {
    items: data.rows as WarehouseRecord[],
    total: (count.rows[0] as { total: number }).total,
  }
}

/** R-UI-CRM-8: PATCH rename — returns null when the id is unknown. */
export async function updateWarehouse(
  db: Db,
  id: string,
  name: string,
): Promise<WarehouseRecord | null> {
  const { rows } = await db.query(
    `UPDATE warehouses SET name = $2 WHERE id = $1 RETURNING id, name, created_at`,
    [id, name],
  )
  return (rows[0] as WarehouseRecord | undefined) ?? null
}

/** R-UI-CRM-8: ledger FK integrity — any movement referencing the warehouse? */
export async function warehouseInUse(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM movements WHERE warehouse_id = $1 LIMIT 1`,
    [id],
  )
  return rows.length > 0
}

/** R-UI-CRM-8: DELETE — only called after the in-use check; null when unknown id. */
export async function deleteWarehouse(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query(
    `DELETE FROM warehouses WHERE id = $1 RETURNING id`,
    [id],
  )
  return rows.length > 0
}

/* ------------------------------ it4: ledger ------------------------------ */

/**
 * Plain movement insert (order_out path — the key is deterministic
 * `order_out:{orderId}:{productId}` and the order row lock serializes writers,
 * so any UNIQUE violation would be a real bug → 500).
 */
export async function insertMovement(db: Db, input: MovementInsertInput): Promise<MovementRecord> {
  const { rows } = await db.query(
    `INSERT INTO movements (product_id, warehouse_id, type, quantity, sign, reason, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${MOVEMENT_COLUMNS}`,
    [input.productId, input.warehouseId, input.type, input.quantity, input.sign, input.reason, input.idempotencyKey],
  )
  return rows[0] as MovementRecord
}

/**
 * R-STK-6 idempotent insert for user-supplied keys: INSERT ON CONFLICT
 * (idempotency_key) DO NOTHING RETURNING — a returned row means "new
 * operation", no row means "key exists" (race → caller re-reads).
 */
export async function insertMovementIfAbsent(
  db: Db,
  input: MovementInsertInput,
): Promise<MovementRecord | null> {
  const { rows } = await db.query(
    `INSERT INTO movements (product_id, warehouse_id, type, quantity, sign, reason, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${MOVEMENT_COLUMNS}`,
    [input.productId, input.warehouseId, input.type, input.quantity, input.sign, input.reason, input.idempotencyKey],
  )
  return (rows[0] as MovementRecord | undefined) ?? null
}

/** R-STK-6 probe / race-loser re-read: existing row by key. */
export async function findByKey(db: Db, idempotencyKey: string): Promise<MovementRecord | null> {
  const { rows } = await db.query(
    `SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE idempotency_key = $1`,
    [idempotencyKey],
  )
  return (rows[0] as MovementRecord | undefined) ?? null
}

/**
 * Transaction-scoped advisory lock for ONE product (design §6/§7: product
 * level, not product×warehouse). Blocks concurrent writers on the same
 * product; released automatically at COMMIT/ROLLBACK.
 */
export async function acquireProductLock(db: Db, productId: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [productId])
}

/**
 * Multiple advisory locks in deterministic ascending order (deadlock
 * impossible). Keys are product ids; sorting is applied in SQL via ORDER BY on
 * the VALUES list (defense-in-depth: also sorted numerically in JS).
 */
export async function acquireProductLocksSorted(db: Db, productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds)].sort((a, b) => Number(a) - Number(b))
  if (unique.length === 0) return
  const placeholders = unique.map((_, index) => `$${index + 1}::text`).join(', ')
  await db.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(t.k, 0))
     FROM (VALUES (${placeholders})) AS t(k)
     ORDER BY t.k`,
    unique,
  )
}

/** Inline SUM recheck inside the movement tx — sees the tx's own uncommitted rows. */
export async function currentStock(db: Db, productId: string, warehouseId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(quantity * sign), 0)::text AS level
     FROM movements WHERE product_id = $1 AND warehouse_id = $2`,
    [productId, warehouseId],
  )
  return (rows[0] as { level: string }).level
}

/** Product reference + threshold for movement paths (choke + refs check). */
export async function findProductForMovement(db: Db, productId: string): Promise<MovementProductRef | null> {
  const { rows } = await db.query(
    `SELECT id, name, sku, low_stock_threshold, active FROM products WHERE id = $1`,
    [productId],
  )
  return (rows[0] as MovementProductRef | undefined) ?? null
}

export async function findWarehouse(db: Db, warehouseId: string): Promise<{ id: string } | null> {
  const { rows } = await db.query(`SELECT id FROM warehouses WHERE id = $1`, [warehouseId])
  return (rows[0] as { id: string } | undefined) ?? null
}

/**
 * Order fulfilment warehouse convention (REPORTED deviation, it4): orders
 * carry no warehouse dimension (spec §3.1/design §7), yet movement rows
 * require warehouse_id. v1 convention: the first (lowest-id) warehouse is the
 * fulfilment point for order_out. Deterministic + changeable in one place.
 */
export async function defaultWarehouseId(db: Db): Promise<string | null> {
  const { rows } = await db.query(`SELECT id FROM warehouses ORDER BY id LIMIT 1`)
  return (rows[0] as { id: string } | undefined)?.id ?? null
}

/** R-STK-8: ledger list with filters + pagination, newest-first. */
export async function listMovements(
  db: Db,
  opts: {
    type?: MovementType | undefined
    productId?: string | undefined
    page: number
    pageSize: number
  },
): Promise<MovementListResult> {
  const where: string[] = []
  const values: unknown[] = []
  if (opts.type) {
    values.push(opts.type)
    where.push(`m.type = $${values.length}`)
  }
  if (opts.productId) {
    values.push(opts.productId)
    where.push(`m.product_id = $${values.length}`)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (opts.page - 1) * opts.pageSize

  const count = await db.query(`SELECT COUNT(*)::int AS total FROM movements m ${whereSql}`, values)
  const data = await db.query(
    `SELECT m.id, m.product_id, m.warehouse_id, m.type, m.quantity, m.sign, m.reason,
            m.idempotency_key, m.created_at, p.sku, p.name AS product_name, w.name AS warehouse_name
     FROM movements m
     JOIN products p ON p.id = m.product_id
     JOIN warehouses w ON w.id = m.warehouse_id
     ${whereSql}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, opts.pageSize, offset],
  )
  return {
    items: data.rows as MovementListRecord[],
    total: (count.rows[0] as { total: number }).total,
  }
}

/** R-STK-2: derived levels per product×warehouse via the view, zero-filled. */
export async function getStock(
  db: Db,
  opts: { productId?: string | undefined; warehouseId?: string | undefined },
): Promise<StockRow[]> {
  const { rows } = await db.query(
    `SELECT p.id AS product_id, p.sku, p.name,
            w.id AS warehouse_id, w.name AS warehouse_name,
            COALESCE(s.level, 0)::text AS level
     FROM products p
     CROSS JOIN warehouses w
     LEFT JOIN stock_levels s ON s.product_id = p.id AND s.warehouse_id = w.id
     WHERE p.active = true
       AND ($1::text IS NULL OR p.id::text = $1)
       AND ($2::text IS NULL OR w.id::text = $2)
     ORDER BY p.sku, w.name`,
    [opts.productId ?? null, opts.warehouseId ?? null],
  )
  return rows as StockRow[]
}