import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import { ApiError, isUniqueViolation } from '../../middleware/errorHandler.ts'
import type { Db } from '../../db/pool.ts'
import { withTransaction } from '../../db/transaction.ts'
import { add, mul } from '../../lib/decimal.ts'
import { writeAudit } from '../audit/write.ts'
import { emitEvent } from '../notifications/emit.ts'
import { NOTIFICATION_TYPES } from '../notifications/types.ts'
import { checkLowStockAndEmit } from '../stock/events.ts'
import { MOVEMENT_SIGNS, MOVEMENT_TYPES } from '../stock/dto.ts'
import * as stockRepo from '../stock/repository.ts'
import type { CancelOrderInput, CreateOrderInput, OrdersListQuery, OrderState } from './dto.ts'
import { ORDER_STATES } from './dto.ts'
import * as orderRepo from './repository.ts'
import type { OrderLineRecord, OrderRecord } from './repository.ts'

/**
 * Orders service (T-3-4 + T-4-6) — pure business rules, framework-independent:
 * status machine (R-ORD-3), exact string totals via lib/decimal (R-ORD-2),
 * create idempotency via Idempotency-Key (R-ORD-4), cancel reason ≥10 (DTO).
 *
 * it4 (T-4-6): `confirm` is THE ATOMIC COMPOSITION (design §7, R-ORD-5) —
 * lock order FOR UPDATE → lock products ASC + sufficiency → order_out
 * movements → mark confirmed + key → audit → emitEvent. Commit-all or
 * rollback-all; insufficient stock → 409 with ZERO side effects. `cancel`
 * writes audit but NEVER reverses stock (R-ORD-6).
 */

const TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  draft: [ORDER_STATES.confirmed, ORDER_STATES.cancelled],
  confirmed: [ORDER_STATES.cancelled],
  cancelled: [],
}

/** R-ORD-3: pure transition predicate. */
export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) {
    throw new ApiError(409, 'INVALID_STATE', `Order cannot transition from ${from} to ${to}`)
  }
}

export interface OrderLineDto {
  id: string
  productId: string
  productName: string
  productSku: string
  qty: number
  unitPrice: string
  lineTotal: string
}

export interface OrderDto {
  id: string
  customerId: string
  state: OrderState
  total: string
  createdAt: string
  lines: OrderLineDto[]
}

function toOrderLineDto(row: OrderLineRecord): OrderLineDto {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    qty: row.quantity,
    unitPrice: row.unit_price, // NUMERIC(13,2) → string, 2 decimals (R-ORD-2)
    lineTotal: row.line_total,
  }
}

export function toOrderDto(order: OrderRecord, lines: OrderLineRecord[]): OrderDto {
  return {
    id: order.id,
    customerId: order.customer_id,
    state: order.state,
    total: order.total,
    createdAt: new Date(order.created_at).toISOString(),
    lines: lines.map(toOrderLineDto),
  }
}

export interface CreateOrderResult {
  order: OrderDto
  /** true = R-ORD-4 replay (HTTP 200), false = new order (201). */
  replay: boolean
}

/**
 * R-ORD-1: create with ≥1 line, existing customer (422 UNKNOWN_CUSTOMER,
 * ADR-1 parity) and existing products (422 UNKNOWN_PRODUCT, ADR-1). R-ORD-2:
 * total = Σ qty × unitPrice via exact string math. R-ORD-4: Idempotency-Key
 * replay returns the existing order (200), never a duplicate.
 */
export async function createOrder(
  db: Pool,
  input: CreateOrderInput,
  createdBy: string,
  idempotencyKey: string | null,
): Promise<CreateOrderResult> {
  const buildOrder = async (client: Db, key: string | null) => {
    const existing = key ? await orderRepo.findByCreateKey(client, key) : null
    if (existing) {
      const lines = await orderRepo.findLines(client, existing.id)
      return { order: toOrderDto(existing, lines), replay: true }
    }
    const customer = await orderRepo.findCustomer(client, input.customerId)
    if (!customer) {
      throw new ApiError(422, 'VALIDATION_ERROR', `UNKNOWN_CUSTOMER: customer ${input.customerId} not found`)
    }
    const productIds = input.lines.map((line) => line.productId)
    const products = await orderRepo.findProductsByIds(client, productIds)
    const found = new Set(products.map((p) => p.id))
    for (const line of input.lines) {
      if (!found.has(line.productId)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `UNKNOWN_PRODUCT: product ${line.productId} not found`)
      }
    }
    const byId = new Map(products.map((p) => [p.id, p]))
    const lineRows: orderRepo.OrderLineInsert[] = input.lines.map((line) => {
      const product = byId.get(line.productId)!
      const lineTotal = mul(String(line.qty), line.unitPrice) // R-ORD-2: exact string math
      return {
        productId: product.id,
        productName: product.name, // snapshot (R-STK-8)
        productSku: product.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal,
      }
    })
    const total = lineRows.reduce((acc, line) => add(acc, line.lineTotal), '0.00')
    const inserted = await orderRepo.insertOrder(client, {
      customerId: input.customerId,
      total,
      createdBy,
      idempotencyKey: key,
    })
    await orderRepo.insertOrderLines(client, inserted.id, lineRows)
    const lines = await orderRepo.findLines(client, inserted.id)
    return { order: toOrderDto(inserted, lines), replay: false }
  }

  try {
    return await withTransaction(db, (client) => buildOrder(client, idempotencyKey))
  } catch (err) {
    // Race: another request committed the same key between probe and insert.
    if (isUniqueViolation(err) && idempotencyKey) {
      return withTransaction(db, async (client) => {
        const existing = await orderRepo.findByCreateKey(client, idempotencyKey!)
        if (existing) {
          const lines = await orderRepo.findLines(client, existing.id)
          return { order: toOrderDto(existing, lines), replay: true }
        }
        throw err
      })
    }
    throw err
  }
}

/**
 * THE ATOMIC SHOWPIECE (T-4-6, R-ORD-5, design §7): confirm executes in ONE
 * transaction — lock order FOR UPDATE → state check (idempotent replay) →
 * lock products ASC + sufficiency → order_out movements (+ low-stock choke) →
 * mark confirmed + key → audit → emitEvent(order_confirmed). Commit-all or
 * rollback-all: insufficient stock → 409 INSUFFICIENT_STOCK with ZERO
 * movements/notifications/audit/jobs; any DB error → 500 with full rollback.
 * it5 (T-5-6/T-5-9): emitEvent enqueues the email job IN THE SAME TX via the
 * pg-boss db adapter (S4 — the R-ORD-5 "email job enqueued" assertion).
 *
 * Warehouse convention (REPORTED deviation): orders carry no warehouse; the
 * fulfilment warehouse is the lowest-id one (stockRepo.defaultWarehouseId).
 */
export async function confirmOrder(
  db: Pool,
  id: string,
  key: string | null,
  actor: { actorId: string; actorUsername: string },
  enqueuer: PgBoss,
): Promise<OrderDto> {
  return withTransaction(db, async (client) => {
    // 1. Row lock — serializes concurrent confirms (design §7).
    const order = await orderRepo.findByIdForUpdate(client, id)
    if (!order) {
      throw new ApiError(404, 'NOT_FOUND', 'Order not found')
    }

    // 2. State check + idempotent replay (R-ORD-5).
    if (order.state === ORDER_STATES.confirmed) {
      if (key && order.confirm_idempotency_key === key) {
        const lines = await orderRepo.findLines(client, id)
        return toOrderDto(order, lines) // replay → 200 original, no new movements
      }
      throw new ApiError(409, 'INVALID_STATE', `Order cannot transition from confirmed to confirmed`)
    }
    assertTransition(order.state, ORDER_STATES.confirmed) // cancelled → 409 INVALID_STATE

    const lines = await orderRepo.findLines(client, id)

    // 3. Product locks (ascending, deadlock-free) + sufficiency per line.
    const warehouseId = await stockRepo.defaultWarehouseId(client)
    if (!warehouseId) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'UNKNOWN_WAREHOUSE: no warehouse configured for order fulfilment',
      )
    }
    await stockRepo.acquireProductLocksSorted(client, lines.map((l) => l.product_id))
    for (const line of lines) {
      const level = await stockRepo.currentStock(client, line.product_id, warehouseId)
      if (line.quantity > Number(level)) {
        throw new ApiError(
          409,
          'INSUFFICIENT_STOCK',
          `Insufficient stock for product ${line.product_id}: need ${line.quantity}, have ${level}`,
        )
      }
    }

    // 4. order_out movements — one immutable row per line (reason per §3.1).
    const productCache = new Map<string, stockRepo.MovementProductRef>()
    const movementIds: string[] = []
    for (const line of lines) {
      const movement = await stockRepo.insertMovement(client, {
        productId: line.product_id,
        warehouseId,
        type: MOVEMENT_TYPES.orderOut,
        quantity: line.quantity,
        sign: MOVEMENT_SIGNS.minus,
        reason: `order ${id} confirmed`,
        idempotencyKey: `order_out:${id}:${line.product_id}`,
      })
      movementIds.push(movement.id)
      let product = productCache.get(line.product_id) ?? null
      if (!product) {
        product = await stockRepo.findProductForMovement(client, line.product_id)
        if (product) productCache.set(line.product_id, product)
      }
      if (product) await checkLowStockAndEmit(client, movement, product, enqueuer) // R-STK-7 choke
    }

    // 5. Status transition + confirm key (same tx).
    const updated = await orderRepo.markConfirmed(client, id, key)

    // 6. Audit row (same tx — rolls back with the business change).
    await writeAudit(client, {
      action: 'order.confirm',
      entity: 'order',
      entityId: id,
      actorId: actor.actorId,
      actorUsername: actor.actorUsername,
      payload: { orderId: id, lines: lines.length, total: order.total, movementIds },
    })

    // 7. Notification rows + email enqueue (T-5-6: both channels for the
    //    order creator; the email job commits with the tx — R-ORD-5/S4).
    await emitEvent(
      client,
      {
        type: NOTIFICATION_TYPES.orderConfirmed,
        reference: `order:${id}`,
        payload: { orderId: id, total: order.total },
        recipientUserIds: [order.created_by],
      },
      enqueuer,
    )

    return toOrderDto(updated!, lines)
  })
}

/**
 * R-ORD-3 + R-ORD-6: draft | confirmed → cancelled (reason ≥10 in DTO).
 * Cancel NEVER inserts reversal movements (ledger integrity — recovery is a
 * manual adjustment); writes the order.cancel audit row with the reason.
 * T-5-9: emits order_cancelled (both channels, creator) in the same tx.
 */
export async function cancelOrder(
  db: Pool,
  id: string,
  input: CancelOrderInput,
  actor: { actorId: string; actorUsername: string },
  enqueuer: PgBoss,
): Promise<OrderDto> {
  return withTransaction(db, async (client) => {
    const order = await orderRepo.findByIdForUpdate(client, id)
    if (!order) {
      throw new ApiError(404, 'NOT_FOUND', 'Order not found')
    }
    assertTransition(order.state, ORDER_STATES.cancelled)
    const updated = await orderRepo.updateOrderState(client, id, ORDER_STATES.cancelled, input.reason)
    await writeAudit(client, {
      action: 'order.cancel',
      entity: 'order',
      entityId: id,
      actorId: actor.actorId,
      actorUsername: actor.actorUsername,
      payload: { orderId: id, reason: input.reason },
    })
    await emitEvent(
      client,
      {
        type: NOTIFICATION_TYPES.orderCancelled,
        reference: `order:${id}`,
        payload: { orderId: id, reason: input.reason },
        recipientUserIds: [order.created_by],
      },
      enqueuer,
    )
    const lines = await orderRepo.findLines(client, id)
    return toOrderDto(updated!, lines)
  })
}

/** R-ORD-7: detail — order + lines in ≤2 queries (no N+1); unknown id → 404. */
export async function getOrder(db: Db, id: string): Promise<OrderDto> {
  const order = await orderRepo.findById(db, id)
  if (!order) {
    throw new ApiError(404, 'NOT_FOUND', 'Order not found')
  }
  const lines = await orderRepo.findLines(db, id)
  return toOrderDto(order, lines)
}

export interface OrderListItemDto {
  id: string
  customerId: string
  state: OrderState
  total: string
  createdAt: string
}

/** R-ORD-7: list with status/customerId filters + pagination. */
export async function listOrders(db: Db, query: OrdersListQuery) {
  const result = await orderRepo.listOrders(db, {
    status: query.status,
    customerId: query.customerId,
    page: query.page,
    pageSize: query.limit,
  })
  return {
    items: result.items.map((order): OrderListItemDto => ({
      id: order.id,
      customerId: order.customer_id,
      state: order.state,
      total: order.total,
      createdAt: new Date(order.created_at).toISOString(),
    })),
    total: result.total,
  }
}