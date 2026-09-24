/**
 * API contract types (capstone-ui it2a, T-2-5) — mirror the backend zod DTO /
 * OpenAPI shapes exactly (the OpenAPI is the reference; tests/fixtures mirror
 * it — R-UI-NFR-6). Numerics travel as D13 strings (design ADR-5) — never
 * `Number()` on money. Const-types pattern for every domain enum
 * (typescript skill — no bare string unions, erasableSyntaxOnly).
 */
import type { Locale } from '../i18n/types.ts'

export type { Locale }

export const ROLES = {
  admin: 'admin',
  manager: 'manager',
  operator: 'operator',
  viewer: 'viewer',
  auditor: 'auditor',
} as const
export type Role = (typeof ROLES)[keyof typeof ROLES]

/** Decimal-13 string, scale ≤ 2 (e.g. "12.50") — float-free money by convention. */
export type D13 = string

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

/** Standard list envelope used by every paginated endpoint. */
export interface Paginated<T> {
  data: T[]
  pagination: Pagination
}

/** PublicUser — login/refresh/me/users DTO (R-BE-4: includes locale). */
export interface PublicUser {
  id: string
  username: string
  fullName: string | null
  email: string
  role: Role
  active: boolean
  locale: Locale
  createdAt: string
}

export interface LoginResponse {
  user: PublicUser
  accessToken: string
}

/** POST /api/auth/refresh — same shape as login (boot restore, R-AUTHUI-4). */
export type RefreshResponse = LoginResponse

/* ── CRM ─────────────────────────────────────────────────────────────── */

export const CUSTOMER_STATUSES = { active: 'active', inactive: 'inactive' } as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[keyof typeof CUSTOMER_STATUSES]

export interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  status: CustomerStatus
  createdAt: string
}

export interface CreateCustomerInput {
  name: string
  email?: string | undefined
  phone?: string | undefined
  notes?: string | undefined
}

export interface UpdateCustomerInput {
  name?: string | undefined
  email?: string | undefined
  phone?: string | undefined
  notes?: string | undefined
  status?: CustomerStatus | undefined
}

/* ── Stock module ────────────────────────────────────────────────────── */

export interface Product {
  id: string
  name: string
  sku: string
  lowStockThreshold: number
  active: boolean
  createdAt: string
}

export interface CreateProductInput {
  name: string
  sku: string
  lowStockThreshold: number
}

export interface UpdateProductInput {
  name?: string | undefined
  sku?: string | undefined
  lowStockThreshold?: number | undefined
  active?: boolean | undefined
}

export interface Warehouse {
  id: string
  name: string
  createdAt: string
}

/**
 * DOCUMENTED ENVELOPE DEVIATION (design ADR-5 / api-surface-gaps #1421):
 * GET /api/stock returns `{items: StockRow[]}` — NOT the standard
 * {data, pagination} envelope. Fields are snake_case (repository rows
 * served as-is). Pagination helpers must never be applied to it (R-UI-STK-1).
 */
export interface StockRow {
  product_id: string
  sku: string
  name: string
  warehouse_id: string
  warehouse_name: string
  /** stock level as a string numeric — compare via string/number rules, never float math */
  level: string
}

export interface StockLevelsResponse {
  items: StockRow[]
}

export const MOVEMENT_TYPES = {
  adjustment: 'adjustment',
  transferOut: 'transfer_out',
  transferIn: 'transfer_in',
  orderOut: 'order_out',
} as const
export type MovementType = (typeof MOVEMENT_TYPES)[keyof typeof MOVEMENT_TYPES]

export interface Movement {
  id: string
  productId: string
  warehouseId: string
  type: MovementType
  quantity: number
  sign: number
  reason: string
  idempotencyKey: string | null
  createdAt: string
}

/**
 * GET /api/stock/movements row (it4 T-4-2) — movement + catalog names,
 * camelCase DTO (backend service toMovementListItemDto).
 */
export interface MovementListItem extends Movement {
  sku: string
  productName: string
  warehouseName: string
}

export interface MovementWriteResponse {
  movement: Movement
}

export interface AdjustMovementInput {
  productId: string
  warehouseId: string
  quantity: number
  reason: string
}

export interface TransferInput {
  productId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: number
  reason: string
}

/* ── Orders ──────────────────────────────────────────────────────────── */

export const ORDER_STATES = { draft: 'draft', confirmed: 'confirmed', cancelled: 'cancelled' } as const
export type OrderState = (typeof ORDER_STATES)[keyof typeof ORDER_STATES]

export interface OrderLine {
  id: string
  productId: string
  productName: string
  productSku: string
  qty: number
  unitPrice: D13
  lineTotal: D13
}

export interface Order {
  id: string
  customerId: string
  state: OrderState
  total: D13
  createdAt: string
  lines: OrderLine[]
}

export interface OrderListItem {
  id: string
  customerId: string
  state: OrderState
  total: D13
  createdAt: string
}

export interface OrderLineInput {
  productId: string
  qty: number
  unitPrice: D13
}

export interface CreateOrderInput {
  customerId: string
  lines: OrderLineInput[]
}

/* ── Notifications ───────────────────────────────────────────────────── */

export interface Notification {
  id: string
  type: string
  channel: string
  title: string
  body: string
  reference: string
  readAt: string | null
  deliveryState: string
  createdAt: string
}

/* ── Observability (dashboard R-UI-DSH-1) ────────────────────────────── */

/** GET /api/status — readiness (any authenticated user, R-OBS-2 + ADR-6). */
export interface SystemStatus {
  version: string
  uptimeSeconds: number
  db: 'up' | 'down'
  timestamp: string
  queues: 'up' | 'down'
}

/** GET /api/health — public liveness (R-OBS-1): 200 ok | 503 degraded. */
export interface HealthStatus {
  status: 'ok' | 'degraded'
  db: 'up' | 'down'
}

/* ── Audit ───────────────────────────────────────────────────────────── */

/** Audit rows are repository rows served as-is — snake_case (R-UI-AUD-1). */
export interface AuditRow {
  id: string
  action: string
  entity: string
  entity_id: string | null
  actor_id: string | null
  actor_username: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

/* ── Jobs ────────────────────────────────────────────────────────────── */

export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const
export type JobState = (typeof JOB_STATES)[number]

export interface Job {
  id: string
  queue: string
  state: JobState
  retryCount: number
  retryLimit: number
  notificationId: string | null
  createdAt: string
  completedAt: string | null
}