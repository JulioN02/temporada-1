import { z } from 'zod'
import { ROLES } from '../../permissions/registry.ts'
import { LOCALE_VALUES } from '../../lib/locales.ts'

/**
 * DTO contracts (zod v4). Const-array + derived union (typescript skill — no
 * bare string unions). NOTE (delta from inventory-stock port): ALL five roles
 * are assignable via the API — the endpoint is admin-only, so granting admin
 * is not an escalation path; the spec only rejects unknown roles (R-AUTH-1).
 */
export const ASSIGNABLE_ROLES = [
  ROLES.admin,
  ROLES.manager,
  ROLES.operator,
  ROLES.viewer,
  ROLES.auditor,
] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

/** R-AUTH-6: 12–128 chars, ≥1 letter, ≥1 digit. R-AUTH-1: role whitelist (invalid → 422). */
export const createUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'username must be at least 3 characters')
      .max(50)
      .regex(/^[a-zA-Z0-9_]+$/, 'username may contain letters, digits and underscores'),
    fullName: z.string().trim().max(100).optional(),
    email: z.email('invalid email').max(254),
    role: z.enum(ASSIGNABLE_ROLES),
    password: z
      .string()
      .min(12, 'password must be at least 12 characters')
      .max(128, 'password must be at most 128 characters')
      .regex(/[a-zA-Z]/, 'password must contain a letter')
      .regex(/[0-9]/, 'password must contain a digit'),
  })
  .strict()

export const loginSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .strict()

export const updateUserSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    active: z.boolean().optional(),
    password: z
      .string()
      .min(12, 'password must be at least 12 characters')
      .max(128, 'password must be at most 128 characters')
      .regex(/[a-zA-Z]/, 'password must contain a letter')
      .regex(/[0-9]/, 'password must contain a digit')
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.role !== undefined || value.active !== undefined || value.password !== undefined,
    { message: 'at least one of role, active or password is required' },
  )

/** Pagination contract: page ≥1 (default 1), limit 1–100 (default 20); invalid → 422. */
export const usersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/**
 * R-BE-4 (capstone-ui it1): self-service locale — PATCH /api/auth/me accepts
 * ONLY `{locale}` ('es'|'en', whitelist from lib/locales). .strict() rejects
 * unknown fields; invalid values → 422 VALIDATION_ERROR.
 */
export const patchMeSchema = z
  .object({
    locale: z.enum(LOCALE_VALUES),
  })
  .strict()

export type CreateUserInput = z.infer<typeof createUserSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type UsersListQuery = z.infer<typeof usersListQuerySchema>
export type PatchMeInput = z.infer<typeof patchMeSchema>