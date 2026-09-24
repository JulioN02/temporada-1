import { z } from 'zod'

/**
 * Notifications DTOs (T-5-7) — zod contracts for the in-app API. Pagination
 * follows the platform convention (page ≥ 1, limit 1-100 default 20).
 */

export const notificationsListQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export interface NotificationsListQuery {
  unreadOnly: boolean
  page: number
  limit: number
}