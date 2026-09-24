import { z } from 'zod'
import { decimalString } from '../../lib/decimal.ts'

/**
 * Orders DTO contracts (T-3-5). Const-array + derived union (typescript
 * skill). R-ORD-1: ≥1 line, product exists (service check → UNKNOWN_PRODUCT),
 * qty integer ≥1, unitPrice D13 (scale ≤ 2 → 422, R-ORD-2). R-ORD-3: cancel
 * reason ≥10 chars.
 */

export const ORDER_STATES = {
  draft: 'draft',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
} as const
export type OrderState = (typeof ORDER_STATES)[keyof typeof ORDER_STATES]
const ORDER_STATE_VALUES = Object.values(ORDER_STATES) as [OrderState, ...OrderState[]]

/**
 * Entity id reference: BIGSERIAL ids are int8 (strings via pg). Accepts a
 * JSON number or a numeric string and canonicalizes to string.
 */
export const idRef = z
  .union([
    z.number().int().positive('id must be a positive integer'),
    z.string().regex(/^\d+$/, 'id must be a positive integer'),
  ])
  .transform(String)

export const orderLineSchema = z
  .object({
    productId: idRef,
    qty: z.number().int().min(1, 'qty must be an integer >= 1'), // R-ORD-1
    unitPrice: decimalString(2), // R-ORD-2: D13, scale > 2 → 422
  })
  .strict()

export const createOrderSchema = z
  .object({
    customerId: idRef,
    lines: z.array(orderLineSchema).min(1, 'order must have at least one line'), // R-ORD-1
  })
  .strict()

export const cancelOrderSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'cancel reason must be at least 10 characters') // R-ORD-3
      .max(500),
  })
  .strict()

export const ordersListQuerySchema = z.object({
  status: z.enum(ORDER_STATE_VALUES).optional(), // R-ORD-7 filter
  customerId: idRef.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>
export type OrdersListQuery = z.infer<typeof ordersListQuerySchema>