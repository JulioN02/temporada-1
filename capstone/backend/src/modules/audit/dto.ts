import { z } from 'zod'

/**
 * Audit read API DTOs (T-6-1, R-AUD-4): GET /api/audit
 * ?entity&action&from&to&page&limit — newest-first, paginated.
 *
 * Filters are exact-match on entity/action (the audit action names are
 * controlled by the platform, e.g. `customer.create`, `order.confirm`).
 * from/to are ISO-8601 datetimes (zod v4 .datetime) — anything else → 422.
 */
export const auditListQuerySchema = z.object({
  entity: z.string().trim().min(1).max(100).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type AuditListQuery = z.infer<typeof auditListQuerySchema>