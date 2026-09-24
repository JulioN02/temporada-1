import { z } from 'zod'

/**
 * CRM DTO contracts (T-2-4). Const-array + derived union (typescript skill —
 * no bare string unions). R-CRM-4: status ∈ active | inactive.
 */
export const CUSTOMER_STATUSES = ['active', 'inactive'] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const createCustomerSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
    email: z.email('invalid email').max(254).optional(), // R-CRM-1: format validated
    phone: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1, 'name must not be empty').max(200).optional(),
    email: z.email('invalid email').max(254).optional(),
    phone: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(2000).optional(),
    status: z.enum(CUSTOMER_STATUSES).optional(), // R-CRM-4: invalid status → 422
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.phone !== undefined ||
      value.notes !== undefined ||
      value.status !== undefined,
    { message: 'at least one field is required' },
  )

/** Pagination contract (shared shape): page ≥1 default 1, limit 1–100 default 20. */
export const customersListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(), // R-CRM-2: substring, case-insensitive
  status: z.enum(CUSTOMER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
export type CustomersListQuery = z.infer<typeof customersListQuerySchema>