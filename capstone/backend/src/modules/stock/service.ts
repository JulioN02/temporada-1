import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import { ApiError, isUniqueViolation } from '../../middleware/errorHandler.ts'
import type { Db } from '../../db/pool.ts'
import { withTransaction } from '../../db/transaction.ts'
import { writeAudit } from '../audit/write.ts'
import type {
  CreateProductInput,
  CreateWarehouseInput,
  MovementCreateInput,
  MovementsListQuery,
  ProductsListQuery,
  StockQuery,
  TransferCreateInput,
  UpdateProductInput,
} from './dto.ts'
import { MOVEMENT_SIGNS, MOVEMENT_TYPES } from './dto.ts'
import { checkLowStockAndEmit } from './events.ts'
import * as stockRepo from './repository.ts'
import type { MovementRecord, MovementProductRef, ProductRecord } from './repository.ts'

/**
 * Stock service (T-3-6 catalog + T-4-4 ledger) — pure business rules,
 * framework-independent. Negative-stock invariant (R-STK-3) and transfer
 * source sufficiency (R-STK-4) are validated WHILE holding the product
 * advisory lock (design §6 — single enforcement point). Every mutation writes
 * an audit row in the same tx (rollback parity); the low-stock choke (ADR-5)
 * runs in-tx after every negative movement.
 */

export interface AuditMeta {
  actorId?: string | null
  actorUsername?: string | null
}

export interface ProductDto {
  id: string
  name: string
  sku: string
  lowStockThreshold: number
  active: boolean
  createdAt: string
}

function toProductDto(row: ProductRecord): ProductDto {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    lowStockThreshold: row.low_stock_threshold,
    active: row.active,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export async function createProduct(db: Db, input: CreateProductInput): Promise<ProductDto> {
  try {
    const product = await stockRepo.insertProduct(db, {
      name: input.name,
      sku: input.sku,
      lowStockThreshold: input.lowStockThreshold,
    })
    return toProductDto(product)
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'DUPLICATE_SKU', 'A product with this sku already exists')
    }
    throw err
  }
}

export async function listProducts(db: Db, query: ProductsListQuery) {
  const result = await stockRepo.listProducts(db, {
    q: query.q,
    page: query.page,
    pageSize: query.limit,
  })
  return { items: result.items.map(toProductDto), total: result.total }
}

export interface WarehouseDto {
  id: string
  name: string
  createdAt: string
}

export async function createWarehouse(db: Db, input: CreateWarehouseInput): Promise<WarehouseDto> {
  try {
    const warehouse = await stockRepo.insertWarehouse(db, input.name)
    return {
      id: warehouse.id,
      name: warehouse.name,
      createdAt: new Date(warehouse.created_at).toISOString(),
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      // NOTE (Batch B deviation #4): the closed 409 subcode list has no
      // warehouse-specific code — generic CONFLICT is used.
      throw new ApiError(409, 'CONFLICT', 'A warehouse with this name already exists')
    }
    throw err
  }
}

/* ----------------------- it1 delta: products PATCH + warehouses CRUD ----------------------- */

/**
 * R-UI-CRM-7 (delta approved): PATCH /api/products/:id — partial update,
 * 404 unknown id, 409 DUPLICATE_SKU on unique violation (same contract as
 * createProduct). `active:false` deactivates — never hard-delete.
 */
export async function updateProduct(
  db: Db,
  id: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  try {
    const product = await stockRepo.updateProduct(db, id, input)
    if (!product) {
      throw new ApiError(404, 'NOT_FOUND', 'Product not found')
    }
    return toProductDto(product)
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'DUPLICATE_SKU', 'A product with this sku already exists')
    }
    throw err
  }
}

export interface WarehouseListResultDto {
  items: WarehouseDto[]
  total: number
}

/** R-UI-CRM-8: GET /api/warehouses — paginated, readable by stock:stock_read (pickers). */
export async function listWarehouses(
  db: Db,
  opts: { page: number; pageSize: number },
): Promise<WarehouseListResultDto> {
  const result = await stockRepo.listWarehouses(db, opts)
  return {
    items: result.items.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: new Date(w.created_at).toISOString(),
    })),
    total: result.total,
  }
}

/** R-UI-CRM-8: PATCH rename — 404 unknown id, 409 CONFLICT on duplicate name. */
export async function renameWarehouse(
  db: Db,
  id: string,
  name: string,
): Promise<WarehouseDto> {
  try {
    const warehouse = await stockRepo.updateWarehouse(db, id, name)
    if (!warehouse) {
      throw new ApiError(404, 'NOT_FOUND', 'Warehouse not found')
    }
    return {
      id: warehouse.id,
      name: warehouse.name,
      createdAt: new Date(warehouse.created_at).toISOString(),
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'CONFLICT', 'A warehouse with this name already exists')
    }
    throw err
  }
}

/**
 * R-UI-CRM-8: DELETE — 204 only when NO movement references the warehouse
 * (ledger FK integrity); otherwise 409 with the ADDITIVE subcode
 * WAREHOUSE_IN_USE (documented — localizeError maps it at it2).
 */
export async function deleteWarehouse(db: Db, id: string): Promise<void> {
  if (await stockRepo.warehouseInUse(db, id)) {
    throw new ApiError(409, 'WAREHOUSE_IN_USE', 'Warehouse is referenced by stock movements')
  }
  const deleted = await stockRepo.deleteWarehouse(db, id)
  if (!deleted) {
    throw new ApiError(404, 'NOT_FOUND', 'Warehouse not found')
  }
}

/* ------------------------------ it4: ledger ------------------------------ */

export interface MovementDto {
  id: string
  productId: string
  warehouseId: string
  type: string
  quantity: number
  sign: number
  reason: string
  idempotencyKey: string | null
  createdAt: string
}

export interface MovementWriteResult {
  movement: MovementDto
  /** true = R-STK-6 replay (HTTP 200), false = new operation (201). */
  replay: boolean
}

function toMovementDto(row: MovementRecord): MovementDto {
  return {
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    type: row.type,
    quantity: row.quantity,
    sign: row.sign,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

/** ADR-1: referential validation failures are 422 VALIDATION_ERROR with UNKNOWN_<ENTITY>. */
function assertMovementRefs(
  product: MovementProductRef | null,
  warehouse: { id: string } | null,
): asserts product is MovementProductRef {
  if (!product) {
    throw new ApiError(422, 'VALIDATION_ERROR', `UNKNOWN_PRODUCT: product not found`)
  }
  if (!product.active) {
    throw new ApiError(422, 'VALIDATION_ERROR', `UNKNOWN_PRODUCT: product is deactivated`)
  }
  if (!warehouse) {
    throw new ApiError(422, 'VALIDATION_ERROR', `UNKNOWN_WAREHOUSE: warehouse not found`)
  }
}

/** R-STK-6 replay: same key → 200 with the original movement. */
function replayResult(existing: MovementRecord): MovementWriteResult {
  return { movement: toMovementDto(existing), replay: true }
}

/**
 * R-STK-3: adjustment — signed quantity (sign derived), mandatory reason ≥10
 * (DTO), negative-stock invariant under the product advisory lock →
 * 409 NEGATIVE_STOCK with zero side effects (whole tx rolls back). Low-stock
 * choke (R-STK-7) fires in-tx on crossing; audit row same-tx.
 */
export async function adjust(
  db: Pool,
  input: MovementCreateInput,
  idempotencyKey: string | null,
  meta: AuditMeta | undefined,
  enqueuer: PgBoss,
): Promise<MovementWriteResult> {
  return withTransaction(db, async (client) => {
    if (idempotencyKey) {
      const existing = await stockRepo.findByKey(client, idempotencyKey)
      if (existing) return replayResult(existing)
    }

    const product = await stockRepo.findProductForMovement(client, input.productId)
    const warehouse = await stockRepo.findWarehouse(client, input.warehouseId)
    assertMovementRefs(product, warehouse)

    const sign = input.quantity < 0 ? MOVEMENT_SIGNS.minus : MOVEMENT_SIGNS.plus
    const magnitude = Math.abs(input.quantity)

    await stockRepo.acquireProductLock(client, input.productId)
    const inserted = await stockRepo.insertMovementIfAbsent(client, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: MOVEMENT_TYPES.adjustment,
      quantity: magnitude,
      sign,
      reason: input.reason,
      idempotencyKey,
    })
    if (!inserted) {
      // Race lost: another tx committed this key between probe and insert.
      const raced = await stockRepo.findByKey(client, idempotencyKey!)
      return replayResult(raced!)
    }

    if (sign === MOVEMENT_SIGNS.minus) {
      const level = await stockRepo.currentStock(client, input.productId, input.warehouseId)
      if (Number(level) < 0) {
        // Invariant violated → whole tx rolls back: level unchanged, no row.
        throw new ApiError(
          409,
          'NEGATIVE_STOCK',
          `Adjustment would drive stock below zero (level ${level})`,
        )
      }
    }

    await checkLowStockAndEmit(client, inserted, product, enqueuer)
    await writeAudit(client, {
      action: 'stock.adjustment',
      entity: 'movement',
      entityId: inserted.id,
      actorId: meta?.actorId ?? null,
      actorUsername: meta?.actorUsername ?? null,
      payload: {
        type: inserted.type,
        quantity: inserted.quantity,
        sign: inserted.sign,
        productId: inserted.product_id,
        warehouseId: inserted.warehouse_id,
        idempotencyKey,
        reason: input.reason,
      },
    })
    return { movement: toMovementDto(inserted), replay: false }
  })
}

/**
 * R-STK-4: atomic transfer — transfer_out (−, source, carries the key) and
 * transfer_in (+, destination, NULL key) in ONE tx under the product advisory
 * lock; from ≠ to enforced in the DTO (422); source sufficiency → 409
 * NEGATIVE_STOCK (no rows survive). Low-stock choke evaluated at the source.
 */
export async function transfer(
  db: Pool,
  input: TransferCreateInput,
  idempotencyKey: string | null,
  meta: AuditMeta | undefined,
  enqueuer: PgBoss,
): Promise<MovementWriteResult> {
  return withTransaction(db, async (client) => {
    if (idempotencyKey) {
      const existing = await stockRepo.findByKey(client, idempotencyKey)
      if (existing) return replayResult(existing)
    }

    const product = await stockRepo.findProductForMovement(client, input.productId)
    const from = await stockRepo.findWarehouse(client, input.fromWarehouseId)
    const to = await stockRepo.findWarehouse(client, input.toWarehouseId)
    assertMovementRefs(product, from)
    if (!to) {
      throw new ApiError(422, 'VALIDATION_ERROR', `UNKNOWN_WAREHOUSE: destination warehouse not found`)
    }

    await stockRepo.acquireProductLock(client, input.productId)
    const outRow = await stockRepo.insertMovementIfAbsent(client, {
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      type: MOVEMENT_TYPES.transferOut,
      quantity: input.quantity,
      sign: MOVEMENT_SIGNS.minus,
      reason: input.reason,
      idempotencyKey,
    })
    if (!outRow) {
      const raced = await stockRepo.findByKey(client, idempotencyKey!)
      return replayResult(raced!)
    }
    await stockRepo.insertMovement(client, {
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      type: MOVEMENT_TYPES.transferIn,
      quantity: input.quantity,
      sign: MOVEMENT_SIGNS.plus,
      reason: input.reason,
      idempotencyKey: null, // secondary row — PG UNIQUE treats NULLs as distinct
    })

    // Destination only gains — recheck the SOURCE only (design §6).
    const level = await stockRepo.currentStock(client, input.productId, input.fromWarehouseId)
    if (Number(level) < 0) {
      throw new ApiError(
        409,
        'NEGATIVE_STOCK',
        `Transfer would drive source stock below zero (level ${level})`,
      )
    }

    await checkLowStockAndEmit(client, outRow, product, enqueuer)
    await writeAudit(client, {
      action: 'stock.transfer',
      entity: 'movement',
      entityId: outRow.id,
      actorId: meta?.actorId ?? null,
      actorUsername: meta?.actorUsername ?? null,
      payload: {
        quantity: outRow.quantity,
        productId: outRow.product_id,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        idempotencyKey,
        reason: input.reason,
      },
    })
    return { movement: toMovementDto(outRow), replay: false }
  })
}

export interface MovementListItemDto extends MovementDto {
  sku: string
  productName: string
  warehouseName: string
}

function toMovementListItemDto(row: stockRepo.MovementListRecord): MovementListItemDto {
  return {
    ...toMovementDto(row),
    sku: row.sku,
    productName: row.product_name,
    warehouseName: row.warehouse_name,
  }
}

/** R-STK-8: ledger list — newest-first, paginated. */
export async function listMovements(db: Db, query: MovementsListQuery) {
  const result = await stockRepo.listMovements(db, {
    type: query.type,
    productId: query.productId,
    page: query.page,
    pageSize: query.limit,
  })
  return {
    items: result.items.map(toMovementListItemDto),
    total: result.total,
  }
}

/** R-STK-2: derived stock per product×warehouse via the view (zero-filled). */
export async function getStock(db: Db, query: StockQuery) {
  const rows = await stockRepo.getStock(db, {
    productId: query.productId,
    warehouseId: query.warehouseId,
  })
  return { items: rows }
}