import type { Db } from '../../db/pool.ts'
import type { CustomerStatus } from './dto.ts'

/**
 * CRM repository (T-2-2) — the ONLY DB access for customers. Parameterized
 * SQL everywhere (R-NFR-1): user input (q, status, ids) travels as bound
 * parameters, never interpolated. The search pattern `%q%` is assembled in JS
 * but the value itself is a parameter — injection attempts are inert.
 */

export interface CustomerRecord {
  id: string // BIGSERIAL → string (pg int8)
  name: string
  email: string | null // CITEXT, nullable by contract
  phone: string | null
  notes: string | null
  status: CustomerStatus
  created_at: Date
  updated_at: Date
}

export async function insertCustomer(
  db: Db,
  input: { name: string; email: string | null; phone: string | null; notes: string | null },
): Promise<CustomerRecord> {
  const { rows } = await db.query(
    `INSERT INTO customers (name, email, phone, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, phone, notes, status, created_at, updated_at`,
    [input.name, input.email, input.phone, input.notes],
  )
  return rows[0] as CustomerRecord
}

export async function findById(db: Db, id: string): Promise<CustomerRecord | null> {
  const { rows } = await db.query(
    `SELECT id, name, email, phone, notes, status, created_at, updated_at
     FROM customers WHERE id = $1`,
    [id],
  )
  return (rows[0] as CustomerRecord | undefined) ?? null
}

export interface CustomerListResult {
  items: CustomerRecord[]
  total: number
}

/**
 * R-CRM-2: q matches name/email case-insensitively (ILIKE substring); status
 * filter; pagination (page ≥1, limit 1–100). R-CRM-4: WITHOUT a status filter
 * the default list excludes inactive customers (default = active only).
 * Exactly 2 queries (count + data) — R-NFR-6.
 */
export async function listCustomers(
  db: Db,
  opts: {
    q?: string | undefined
    status?: CustomerStatus | undefined
    page: number
    pageSize: number
  },
): Promise<CustomerListResult> {
  const where: string[] = []
  const values: unknown[] = []
  if (opts.q) {
    values.push(`%${opts.q}%`)
    values.push(`%${opts.q}%`)
    where.push(`(name ILIKE $${values.length - 1} OR email::text ILIKE $${values.length})`)
  }
  // R-CRM-4: no filter → active only; explicit status filter → that status.
  values.push(opts.status ?? 'active')
  where.push(`status = $${values.length}`)
  const whereSql = `WHERE ${where.join(' AND ')}`
  const offset = (opts.page - 1) * opts.pageSize

  const count = await db.query(`SELECT COUNT(*)::int AS total FROM customers c ${whereSql}`, values)
  const data = await db.query(
    `SELECT id, name, email, phone, notes, status, created_at, updated_at
     FROM customers c
     ${whereSql}
     ORDER BY c.id
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, opts.pageSize, offset],
  )
  return {
    items: data.rows as CustomerRecord[],
    total: (count.rows[0] as { total: number }).total,
  }
}

export interface UpdateCustomerInput {
  name?: string | undefined
  email?: string | undefined
  phone?: string | undefined
  notes?: string | undefined
  status?: CustomerStatus | undefined
}

/** Updates only the provided fields; returns null for unknown ids. */
export async function updateCustomer(
  db: Db,
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerRecord | null> {
  const sets: string[] = ['updated_at = now()']
  const values: unknown[] = []
  if (input.name !== undefined) {
    values.push(input.name)
    sets.push(`name = $${values.length}`)
  }
  if (input.email !== undefined) {
    values.push(input.email)
    sets.push(`email = $${values.length}`)
  }
  if (input.phone !== undefined) {
    values.push(input.phone)
    sets.push(`phone = $${values.length}`)
  }
  if (input.notes !== undefined) {
    values.push(input.notes)
    sets.push(`notes = $${values.length}`)
  }
  if (input.status !== undefined) {
    values.push(input.status)
    sets.push(`status = $${values.length}`)
  }
  values.push(id)
  const { rows } = await db.query(
    `UPDATE customers SET ${sets.join(', ')} WHERE id = $${values.length}
     RETURNING id, name, email, phone, notes, status, created_at, updated_at`,
    values,
  )
  return (rows[0] as CustomerRecord | undefined) ?? null
}