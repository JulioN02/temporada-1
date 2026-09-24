/**
 * UI mirror of the backend role → permission matrix (capstone-ui it2b,
 * T-2-7 — design ADR-6). SINGLE SOURCE OF TRUTH is
 * `backend/src/permissions/registry.ts` (ROLE_PERMISSIONS); the parity test
 * (R-RBAC-3) imports the backend registry directly across workspaces and
 * deep-equals it against this mirror — keeping the UI honest when backend
 * RBAC changes. Unknown roles → empty permission set (no privileged UI).
 * Const-type pattern (typescript skill): const object + derived unions —
 * never bare string unions.
 */
export const ROLE_PERMISSIONS = {
  admin: [
    'auth:user_create',
    'auth:user_read',
    'auth:user_update',
    'crm:customer_create',
    'crm:customer_read',
    'crm:customer_update',
    'orders:order_create',
    'orders:order_read',
    'orders:order_confirm',
    'orders:order_cancel',
    'stock:product_manage',
    'stock:stock_adjust',
    'stock:stock_transfer',
    'stock:stock_read',
    'jobs:job_read',
    'jobs:job_retry',
    'notification:read',
    'notification:update',
    'audit:read',
  ],
  manager: [
    'crm:customer_create',
    'crm:customer_read',
    'crm:customer_update',
    'orders:order_create',
    'orders:order_read',
    'orders:order_confirm',
    'orders:order_cancel',
    'stock:product_manage',
    'stock:stock_adjust',
    'stock:stock_transfer',
    'stock:stock_read',
    'notification:read',
    'notification:update',
    'jobs:job_read',
    'jobs:job_retry',
  ],
  operator: [
    'crm:customer_create',
    'crm:customer_read',
    'crm:customer_update',
    'orders:order_create',
    'orders:order_read',
    'orders:order_confirm',
    'orders:order_cancel',
    'stock:stock_adjust',
    'stock:stock_read',
    'notification:read',
    'notification:update',
  ],
  viewer: [
    'crm:customer_read',
    'orders:order_read',
    'stock:stock_read',
    'notification:read',
    'notification:update',
  ],
  auditor: [
    'crm:customer_read',
    'orders:order_read',
    'stock:stock_read',
    'notification:read',
    'notification:update',
    'audit:read',
  ],
} as const

export type Role = keyof typeof ROLE_PERMISSIONS

/** Every permission code the UI may gate on (derived from the mirror). */
export type RolePermission = (typeof ROLE_PERMISSIONS)[Role][number]

/**
 * Pure lookup (kept out of AuthContext so it stays trivially testable).
 * Unknown roles get an empty set — they see no permission-gated UI.
 */
export function roleHasPermission(role: string, permission: RolePermission | string): boolean {
  if (role in ROLE_PERMISSIONS) {
    return (ROLE_PERMISSIONS[role as Role] as readonly string[]).includes(permission)
  }
  return false
}