import type { Db } from '../../db/pool.ts'
import type { OrderState } from './dto.ts'

/**
 * Orders repository (T-3-3) — the ONLY DB access for orders/lines. All SQL
 * parameterized (R-NFR-1). Detail = exactly 2 queries (order + lines), no
 * N+1 (R-ORD-7/R-NFR-6). Money columns are NUMERIC(13,2) → pg returns strings
 * (D13 pass-through, R-ORD-2).
 */

export interface OrderRecord {
  id: string
  customer_id: string
  state: OrderState
  total: string
  created_by: string
  idempotency_key: string | null
  confirm_idempotency_key: string | null
  confirmed_at: Date | null
  cancelled_at: Date | null
  cancel_reason: string | null
  created_at: Date
  updated_at: Date
}

export interface OrderLineRecord {
  id: string
  order_id: string
  product_id: string
  product_name: string
  product_sku: string
  quantity: number
  unit_price: string
  line_total: string
}

export interface ProductRef {
  id: string
  name: string
  sku: string
}

const ORDER_COLUMNS = `
  id, customer_id, state, total, created_by, idempotency_key,
  confirm_idempotency_key, confirmed_at, cancelled_at, cancel_reason, created_at, updated_at
`

export async function findCustomer(db: Db, id: string): Promise<{ id: string } | null> {
  const { rows } = await db.query(`SELECT id FROM customers WHERE id = $1`, [id])
  return (rows[0] as { id: string } | undefined) ?? null
}

/** Bulk product lookup by ids (parameterized IN clause) — validates existence + snapshots. */
export async function findProductsByIds(db: Db, ids: string[]): Promise<ProductRef[]> {
  if (ids.length === 0) return []
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ')
  const { rows } = await db.query(
    `SELECT id, name, sku FROM products WHERE id IN (${placeholders})`,
    ids,
  )
  return rows as ProductRef[]
}

export async function insertOrder(
  db: Db,
  input: { customerId: string; total: string; createdBy: string; idempotencyKey: string | null },
): Promise<OrderRecord> {
  const { rows } = await db.query(
    `INSERT INTO orders (customer_id, total, created_by, idempotency_key)
     VALUES ($1, $2, $3, $4)
     RETURNING ${ORDER_COLUMNS}`,
    [input.customerId, input.total, input.createdBy, input.idempotencyKey],
  )
  return rows[0] as OrderRecord
}

export interface OrderLineInsert {
  productId: string
  productName: string
  productSku: string
  qty: number
  unitPrice: string
  lineTotal: string
}

export async function insertOrderLines(
  db: Db,
  orderId: string,
  lines: OrderLineInsert[],
): Promise<void> {
  if (lines.length === 0) return
  const values: unknown[] = []
  const tuples = lines.map((line, index) => {
    const base = index * 7
    values.push(
      orderId,
      line.productId,
      line.productName,
      line.productSku,
      line.qty,
      line.unitPrice,
      line.lineTotal,
    )
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
  })
  await db.query(
    `INSERT INTO order_items
       (order_id, product_id, product_name, product_sku, quantity, unit_price, line_total)
     VALUES ${tuples.join(', ')}`,
    values,
  )
}

/** R-ORD-4 probe: the create idempotency key is unique per order. */
export async function findByCreateKey(db: Db, key: string): Promise<OrderRecord | null> {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE idempotency_key = $1`,
    [key],
  )
  return (rows[0] as OrderRecord | undefined) ?? null
}

export async function findById(db: Db, id: string): Promise<OrderRecord | null> {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`,
    [id],
  )
  return (rows[0] as OrderRecord | undefined) ?? null
}

/** Row lock for state transitions — serializes concurrent confirm/cancel (design §7). */
export async function findByIdForUpdate(db: Db, id: string): Promise<OrderRecord | null> {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return (rows[0] as OrderRecord | undefined) ?? null
}

export async function findLines(db: Db, orderId: string): Promise<OrderLineRecord[]> {
  const { rows } = await db.query(
    `SELECT id, order_id, product_id, product_name, product_sku, quantity, unit_price, line_total
     FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId],
  )
  return rows as OrderLineRecord[]
}

export interface OrderListResult {
  items: OrderRecord[]
  total: number
}

/** R-ORD-7: list with status/customerId filters + pagination — exactly 2 queries. */
export async function listOrders(
  db: Db,
  opts: {
    status?: OrderState | undefined
    customerId?: string | undefined
    page: number
    pageSize: number
  },
): Promise<OrderListResult> {
  const where: string[] = []
  const values: unknown[] = []
  if (opts.status) {
    values.push(opts.status)
    where.push(`state = $${values.length}`)
  }
  if (opts.customerId) {
    values.push(opts.customerId)
    where.push(`customer_id = $${values.length}`)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (opts.page - 1) * opts.pageSize

  const count = await db.query(`SELECT COUNT(*)::int AS total FROM orders ${whereSql}`, values)
  const data = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM orders ${whereSql}
     ORDER BY id
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, opts.pageSize, offset],
  )
  return {
    items: data.rows as OrderRecord[],
    total: (count.rows[0] as { total: number }).total,
  }
}

/** R-ORD-3 transition: conditional UPDATE inside the row lock; null when the id is unknown. */
export async function updateOrderState(
  db: Db,
  id: string,
  state: OrderState,
  cancelReason: string | null,
): Promise<OrderRecord | null> {
  const { rows } = await db.query(
    `UPDATE orders SET
       state = $2,
       updated_at = now(),
       confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END,
       cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
       cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END
     WHERE id = $1
     RETURNING ${ORDER_COLUMNS}`,
    [id, state, cancelReason],
  )
  return (rows[0] as OrderRecord | undefined) ?? null
}

/**
 * R-ORD-5 (T-4-6): atomic-confirm state write — sets confirmed + stores the
 * confirm idempotency key in the SAME update (design §7 step 5). Runs inside
 * the composition tx; the order row is already locked FOR UPDATE.
 */
export async function markConfirmed(
  db: Db,
  id: string,
  confirmIdempotencyKey: string | null,
): Promise<OrderRecord | null> {
  const { rows } = await db.query(
    `UPDATE orders SET
       state = 'confirmed',
       updated_at = now(),
       confirmed_at = now(),
       confirm_idempotency_key = $2
     WHERE id = $1
     RETURNING ${ORDER_COLUMNS}`,
    [id, confirmIdempotencyKey],
  )
  return (rows[0] as OrderRecord | undefined) ?? null
}