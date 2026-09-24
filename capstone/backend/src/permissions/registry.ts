/**
 * Const-type permission registry (typescript skill: const objects + mapped
 * union — never bare string unions). Mirrors the seeded `permissions` table
 * and the locked role × permission matrix (spec §5, ADR-7). The R-AUTH-7
 * parity test asserts registry ≡ SQL seeds (roles + permissions sets); the
 * per-request DB check (R-AUTH-8) is a role lookup via user_roles — the
 * role → permission matrix below is the single source of truth.
 */
export const PERMISSIONS = {
  auth: {
    user_create: 'auth:user_create',
    user_read: 'auth:user_read',
    user_update: 'auth:user_update',
  },
  crm: {
    customer_create: 'crm:customer_create',
    customer_read: 'crm:customer_read',
    customer_update: 'crm:customer_update',
  },
  orders: {
    order_create: 'orders:order_create',
    order_read: 'orders:order_read',
    order_confirm: 'orders:order_confirm',
    order_cancel: 'orders:order_cancel',
  },
  stock: {
    product_manage: 'stock:product_manage',
    stock_adjust: 'stock:stock_adjust',
    stock_transfer: 'stock:stock_transfer',
    stock_read: 'stock:stock_read',
  },
  jobs: {
    job_read: 'jobs:job_read',
    job_retry: 'jobs:job_retry',
  },
  notification: {
    read: 'notification:read',
    update: 'notification:update',
  },
  audit: { read: 'audit:read' },
} as const

/** Mapped-type union: every leaf value of the nested const object (e.g. 'orders:order_confirm'). */
export type Permission = {
  [Module in keyof typeof PERMISSIONS]: (typeof PERMISSIONS)[Module][keyof (typeof PERMISSIONS)[Module]]
}[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS).flatMap(
  (module) => Object.values(module) as Permission[],
)

export const ROLES = {
  admin: 'admin',
  manager: 'manager',
  operator: 'operator',
  viewer: 'viewer',
  auditor: 'auditor',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

const crmAll = [
  PERMISSIONS.crm.customer_create,
  PERMISSIONS.crm.customer_read,
  PERMISSIONS.crm.customer_update,
] as const

const ordersAll = [
  PERMISSIONS.orders.order_create,
  PERMISSIONS.orders.order_read,
  PERMISSIONS.orders.order_confirm,
  PERMISSIONS.orders.order_cancel,
] as const

const stockAll = [
  PERMISSIONS.stock.product_manage,
  PERMISSIONS.stock.stock_adjust,
  PERMISSIONS.stock.stock_transfer,
  PERMISSIONS.stock.stock_read,
] as const

const notificationsAll = [PERMISSIONS.notification.read, PERMISSIONS.notification.update] as const

const readOnly = [
  PERMISSIONS.crm.customer_read,
  PERMISSIONS.orders.order_read,
  PERMISSIONS.stock.stock_read,
] as const

/** Mirrors the locked role → permission matrix (spec §5). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: [...crmAll, ...ordersAll, ...stockAll, ...notificationsAll, PERMISSIONS.jobs.job_read, PERMISSIONS.jobs.job_retry],
  operator: [...crmAll, ...ordersAll, PERMISSIONS.stock.stock_adjust, PERMISSIONS.stock.stock_read, ...notificationsAll],
  viewer: [...readOnly, ...notificationsAll],
  auditor: [...readOnly, ...notificationsAll, PERMISSIONS.audit.read],
}