import type { TFunction } from '../../i18n/types.ts'

/**
 * Stock form helpers (it4 T-4-1..T-4-4 — R-UI-STK-1/3/4). Pure functions
 * with the translator injected. Levels are STRING numerics — compared as
 * integers, never floats (R-UI-STK-1). Client-side validation blocks fire
 * NO request.
 */

/** level <= threshold counts as low (equal included — R-UI-STK-1 scenario). */
export function isLowStock(level: string, threshold: number): boolean {
  return Number(level) <= threshold
}

export interface AdjustInput {
  quantity: string
  reason: string
}

export function validateAdjust(
  input: AdjustInput,
  t: TFunction,
): { quantity?: string | undefined; reason?: string | undefined } {
  const errors: { quantity?: string | undefined; reason?: string | undefined } = {}
  const quantity = input.quantity.trim()
  if (quantity === '' || !/^-?\d+$/.test(quantity) || Number(quantity) === 0) {
    errors.quantity = t('stock.adjust.qtyInvalid')
  }
  if (input.reason.trim().length < 10) {
    errors.reason = t('stock.reasonMin')
  }
  return errors
}

export interface TransferInput {
  fromWarehouseId: string
  toWarehouseId: string
  quantity: string
  reason: string
}

export function validateTransfer(
  input: TransferInput,
  t: TFunction,
): { warehouses?: string | undefined; quantity?: string | undefined; reason?: string | undefined } {
  const errors: { warehouses?: string | undefined; quantity?: string | undefined; reason?: string | undefined } = {}
  if (input.fromWarehouseId !== '' && input.fromWarehouseId === input.toWarehouseId) {
    errors.warehouses = t('stock.transfer.warehousesMustDiffer')
  }
  const quantity = input.quantity.trim()
  if (quantity === '' || !/^\d+$/.test(quantity) || Number(quantity) < 1) {
    errors.quantity = t('stock.transfer.qtyMin')
  }
  if (input.reason.trim().length < 10) {
    errors.reason = t('stock.reasonMin')
  }
  return errors
}

/** Movement type → dictionary key (display label for filter + table cells). */
export const MOVEMENT_TYPE_KEYS = {
  adjustment: 'stock.movements.type.adjustment',
  transfer_out: 'stock.movements.type.transferOut',
  transfer_in: 'stock.movements.type.transferIn',
  order_out: 'stock.movements.type.orderOut',
} as const