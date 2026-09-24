import type { PgBoss } from 'pg-boss'
import type { Db } from '../../db/pool.ts'
import { emitEvent } from '../notifications/emit.ts'
import { NOTIFICATION_TYPES } from '../notifications/types.ts'
import { MOVEMENT_SIGNS } from './dto.ts'
import * as stockRepo from './repository.ts'
import type { MovementRecord } from './repository.ts'

/**
 * Low-stock choke point (T-4-3, ADR-5, R-STK-7). ONE shared rule evaluated for
 * EVERY movement write (adjustment, transfer, order_out — the shared
 * movement-write path). Fires iff `sign = −1 AND new level < threshold`.
 * Detection happens under the already-held product advisory lock → race-free.
 * Effects (notification rows for active manager+operator, ADR-4 — BOTH
 * channels since it5, R-NOT-2) run in the SAME transaction. Dedupe is
 * post-v1 (reference low_stock:{movementId} keeps per-crossing rows).
 */

export interface LowStockCheckInput {
  sign: number
  newLevel: number
  threshold: number
}

/** Pure rule — unit-tested (tests/unit/lowStockRule.test.ts). */
export function lowStockShouldFire(input: LowStockCheckInput): boolean {
  return input.sign === MOVEMENT_SIGNS.minus && input.newLevel < input.threshold
}

/** Product snapshot needed by the choke (threshold + template fields). */
export interface LowStockProductRef {
  id: string
  name: string
  sku: string
  low_stock_threshold: number
}

/**
 * THE choke point: called right after a movement insert (same tx). Reads the
 * post-insert derived level and emits `low_stock` rows when the rule fires.
 * it5: the email channel enqueues jobs in the same tx (enqueuer).
 */
export async function checkLowStockAndEmit(
  db: Db,
  movement: MovementRecord,
  product: LowStockProductRef,
  enqueuer: PgBoss,
): Promise<void> {
  if (movement.sign !== MOVEMENT_SIGNS.minus) return
  const level = await stockRepo.currentStock(db, movement.product_id, movement.warehouse_id)
  if (!lowStockShouldFire({ sign: movement.sign, newLevel: Number(level), threshold: product.low_stock_threshold })) {
    return
  }
  await emitEvent(
    db,
    {
      type: NOTIFICATION_TYPES.lowStock,
      reference: `low_stock:${movement.id}`,
      payload: {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        level,
        threshold: product.low_stock_threshold,
        warehouseId: movement.warehouse_id,
        movementId: movement.id,
      },
    },
    enqueuer,
  )
}