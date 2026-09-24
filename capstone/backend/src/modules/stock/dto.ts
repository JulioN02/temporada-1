import { z } from 'zod'
import { idRef } from '../orders/dto.ts'

/**
 * Stock DTO contracts (T-3-6 catalog + T-4-5 movements/transfers/stock reads).
 * Const registries (typescript skill — never bare string unions).
 * R-STK-3: adjustment reason ≥10, quantity signed (spec scenario "quantity −5");
 * sign is DERIVED from the quantity sign, magnitude stored (design §6: quantity>0).
 * R-STK-4: transfer from ≠ to → 422; reason ≥10.
 */
export const MOVEMENT_TYPES = {
  adjustment: 'adjustment',
  transferOut: 'transfer_out',
  transferIn: 'transfer_in',
  orderOut: 'order_out',
} as const
export type MovementType = (typeof MOVEMENT_TYPES)[keyof typeof MOVEMENT_TYPES]
const MOVEMENT_TYPE_VALUES = Object.values(MOVEMENT_TYPES) as [MovementType, ...MovementType[]]

export const MOVEMENT_SIGNS = { plus: 1, minus: -1 } as const
export type MovementSign = (typeof MOVEMENT_SIGNS)[keyof typeof MOVEMENT_SIGNS]

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
    sku: z
      .string()
      .trim()
      .min(1, 'sku is required')
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/, 'sku may contain letters, digits, dots, dashes and underscores'),
    lowStockThreshold: z.number().int().min(0).default(0),
  })
  .strict()

export const productsListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const createWarehouseSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
  })
  .strict()

/**
 * R-UI-CRM-7 (capstone-ui it1, delta approved): PATCH /api/products/:id —
 * name/sku/lowStockThreshold/active, at least one field (refine → 422),
 * mirrors the updateUserSchema pattern. `active:false` deactivates — never
 * hard-delete (order-line snapshots intact, R-STK-8).
 */
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200).optional(),
    sku: z
      .string()
      .trim()
      .min(1, 'sku is required')
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/, 'sku may contain letters, digits, dots, dashes and underscores')
      .optional(),
    lowStockThreshold: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.sku !== undefined ||
      value.lowStockThreshold !== undefined ||
      value.active !== undefined,
    { message: 'at least one of name, sku, lowStockThreshold or active is required' },
  )

/** R-UI-CRM-8 (capstone-ui it1): PATCH /api/warehouses/:id — rename only. */
export const updateWarehouseSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
  })
  .strict()

/** Pagination contract for GET /api/warehouses (platform convention). */
export const warehousesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/**
 * R-STK-3: POST /api/stock/movements — type is locked to 'adjustment' on this
 * endpoint (transfer_out/in and order_out are internal to transfers/confirm).
 * quantity is a NON-ZERO signed integer; the sign of the movement is derived.
 */
export const movementCreateSchema = z
  .object({
    type: z.literal(MOVEMENT_TYPES.adjustment),
    productId: idRef,
    warehouseId: idRef,
    quantity: z.number().int().refine((v) => v !== 0, 'quantity must not be zero'),
    reason: z
      .string()
      .trim()
      .min(10, 'adjustment reason must be at least 10 characters') // R-STK-3
      .max(500),
  })
  .strict()

/** R-STK-4: transfer — from ≠ to (refined → 422), quantity ≥ 1, reason ≥10. */
export const transferCreateSchema = z
  .object({
    productId: idRef,
    fromWarehouseId: idRef,
    toWarehouseId: idRef,
    quantity: z.number().int().min(1, 'quantity must be a positive integer'),
    reason: z
      .string()
      .trim()
      .min(10, 'transfer reason must be at least 10 characters')
      .max(500),
  })
  .strict()
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    message: 'from and to warehouses must differ',
    path: ['toWarehouseId'],
  })

export const movementsListQuerySchema = z.object({
  productId: idRef.optional(),
  type: z.enum(MOVEMENT_TYPE_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/** GET /api/stock — optional product/warehouse filters. */
export const stockQuerySchema = z.object({
  productId: idRef.optional(),
  warehouseId: idRef.optional(),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>
export type WarehousesListQuery = z.infer<typeof warehousesListQuerySchema>
export type ProductsListQuery = z.infer<typeof productsListQuerySchema>
export type MovementCreateInput = z.infer<typeof movementCreateSchema>
export type TransferCreateInput = z.infer<typeof transferCreateSchema>
export type MovementsListQuery = z.infer<typeof movementsListQuerySchema>
export type StockQuery = z.infer<typeof stockQuerySchema>