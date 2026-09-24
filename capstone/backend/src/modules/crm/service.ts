import type { Pool } from 'pg'
import { ApiError, isUniqueViolation } from '../../middleware/errorHandler.ts'
import type { Db } from '../../db/pool.ts'
import { withTransaction } from '../../db/transaction.ts'
import { writeAudit } from '../audit/write.ts'
import type { CreateCustomerInput, CustomersListQuery, UpdateCustomerInput } from './dto.ts'
import type { CustomerStatus } from './dto.ts'
import * as crmRepo from './repository.ts'
import type { CustomerRecord } from './repository.ts'

/**
 * CRM service (T-2-3) — pure business rules, framework-independent:
 * dup-email rules (23505 → 409 DUPLICATE_EMAIL), 404 semantics, default-list
 * status rule (service passes the resolved filter to the repository), and
 * same-transaction audit on every mutation (R-CRM-5).
 */

export interface CustomerDto {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  status: CustomerStatus
  createdAt: string
}

export function toCustomerDto(row: CustomerRecord): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

/** Mutation meta: acting identity only (R-AUD-3 — never credentials). */
export interface AuditMeta {
  actorId?: string | null
  actorUsername?: string | null
}

/**
 * R-CRM-1: create with duplicate email → 409 DUPLICATE_EMAIL. R-CRM-5: audit
 * row written in the SAME transaction — a failed insert (23505) rolls back
 * everything, so no orphan audit row survives (rollback parity).
 */
export async function createCustomer(
  db: Pool,
  input: CreateCustomerInput,
  meta?: AuditMeta,
): Promise<CustomerDto> {
  try {
    return await withTransaction(db, async (client) => {
      const customer = await crmRepo.insertCustomer(client, {
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      })
      await writeAudit(client, {
        action: 'customer.create',
        entity: 'customer',
        entityId: customer.id,
        actorId: meta?.actorId ?? null,
        actorUsername: meta?.actorUsername ?? null,
        payload: { name: customer.name, email: customer.email, status: customer.status, outcome: 'success' },
      })
      return toCustomerDto(customer)
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'DUPLICATE_EMAIL', 'A customer with this email already exists')
    }
    throw err
  }
}

/** R-CRM-2/R-CRM-4: list with q / status / pagination; default excludes inactive. */
export async function listCustomers(db: Db, query: CustomersListQuery) {
  const result = await crmRepo.listCustomers(db, {
    q: query.q,
    status: query.status,
    page: query.page,
    pageSize: query.limit,
  })
  return {
    items: result.items.map(toCustomerDto),
    total: result.total,
  }
}

/** GET /:id — any status retrievable by id (R-CRM-4). */
export async function getCustomer(db: Db, id: string): Promise<CustomerDto> {
  const customer = await crmRepo.findById(db, id)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
  return toCustomerDto(customer)
}

/**
 * R-CRM-3: PATCH with unknown id → 404; duplicate email on update → 409.
 * R-CRM-4: status transitions happen here (active ↔ inactive).
 */
export async function updateCustomer(
  db: Pool,
  id: string,
  input: UpdateCustomerInput,
  meta?: AuditMeta,
): Promise<CustomerDto> {
  try {
    return await withTransaction(db, async (client) => {
      const updated = await crmRepo.updateCustomer(client, id, {
        name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        status: input.status,
      })
      if (!updated) {
        throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
      }
      await writeAudit(client, {
        action: 'customer.update',
        entity: 'customer',
        entityId: updated.id,
        actorId: meta?.actorId ?? null,
        actorUsername: meta?.actorUsername ?? null,
        payload: {
          name: updated.name,
          email: updated.email,
          status: updated.status,
          outcome: 'success',
        },
      })
      return toCustomerDto(updated)
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'DUPLICATE_EMAIL', 'A customer with this email already exists')
    }
    throw err
  }
}