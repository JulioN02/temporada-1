// First import — ensures the shared zod carries `.openapi()` before the DTO
// modules below create their schemas (zod v4 per-instance method copying).
import './extend.ts'
import { z } from 'zod'
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from '@asteasolutions/zod-to-openapi/dist/index.mjs'
import { createRequire } from 'node:module'
import { Router } from 'express'
import express from 'express'
import type { AppConfig } from '../config/env.ts'
// R-DOC-1 (single source of truth): the registry consumes the EXACT zod DTOs
// that validateDto/parseOrThrow use at runtime.
import {
  createUserSchema,
  loginSchema,
  patchMeSchema,
  updateUserSchema,
  usersListQuerySchema,
} from '../modules/auth/dto.ts'
import {
  createCustomerSchema,
  customersListQuerySchema,
  updateCustomerSchema,
} from '../modules/crm/dto.ts'
import {
  cancelOrderSchema,
  createOrderSchema,
  ordersListQuerySchema,
} from '../modules/orders/dto.ts'
import {
  createProductSchema,
  createWarehouseSchema,
  movementCreateSchema,
  movementsListQuerySchema,
  productsListQuerySchema,
  stockQuerySchema,
  transferCreateSchema,
  updateProductSchema,
  updateWarehouseSchema,
  warehousesListQuerySchema,
} from '../modules/stock/dto.ts'
import { notificationsListQuerySchema } from '../modules/notifications/dto.ts'
import { jobsListQuerySchema } from '../modules/jobs/dto.ts'
import { auditListQuerySchema } from '../modules/audit/dto.ts'
import { NOTIFICATION_TYPES } from '../modules/notifications/types.ts'

/**
 * OpenAPI 3.1 generation (T-6-4, R-DOC-1/2): the spec is DERIVED AT STARTUP
 * from the same zod DTOs that `validateDto` uses — single source of truth,
 * no hand-written openapi file anywhere in src/ (R-DOC-2 scan enforces it).
 *
 * - Request bodies/queries reference the module DTOs directly.
 * - Money fields (ADR-8) are registered as `string` with the D13 pattern.
 * - Notification types come from the NOTIFICATION_TYPES registry (ADR-3).
 * - Swagger UI is self-hosted from bundled swagger-ui-dist assets (offline
 *   appliance — no CDN).
 */

// ---------------------------------------------------------------------------
// Component schemas — output shapes (inputs use the REAL module DTOs above).
// ---------------------------------------------------------------------------

const money = z.string().regex(/^\d+\.\d{2}$/, 'D13 money: exactly 2 decimals')
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
})

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  active: z.boolean(),
  locale: z.enum(['es', 'en']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const orderLineSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  productId: z.string(),
  productName: z.string(),
  productSku: z.string(),
  quantity: z.number(),
  unitPrice: money,
  lineTotal: money,
})

const orderSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  state: z.enum(['draft', 'confirmed', 'cancelled']),
  total: money,
  createdBy: z.string(),
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(orderLineSchema).optional(),
})

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  lowStockThreshold: z.number(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const warehouseSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
})

const stockLevelSchema = z.object({
  productId: z.string(),
  warehouseId: z.string(),
  level: z.number(),
})

const movementSchema = z.object({
  id: z.string(),
  productId: z.string(),
  warehouseId: z.string(),
  type: z.string(),
  quantity: z.number(),
  sign: z.number(),
  reason: z.string(),
  idempotencyKey: z.string(),
  createdAt: z.string(),
})

const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  channel: z.string(),
  title: z.string(),
  body: z.string(),
  reference: z.string(),
  readAt: z.string().nullable(),
  deliveryState: z.string(),
  createdAt: z.string(),
})

const jobSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  retryCount: z.number(),
  data: z.unknown().nullable(),
  createdOn: z.string(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
})

const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorUsername: z.string().nullable(),
  payload: z.unknown().nullable(),
  createdAt: z.string(),
})

const healthSchema = z.object({ status: z.string(), db: z.string() })
const statusSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number(),
  db: z.string(),
  timestamp: z.string(),
  queues: z.string(),
})

const listEnvelope = (item: z.ZodType) =>
  z.object({ data: z.array(item), pagination: paginationSchema })

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const API_VERSION = '3.1.0'

function ref(name: string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` }
}

const jsonContent = (schema: z.ZodType | { $ref: string }) => ({
  'application/json': { schema },
})

interface EndpointSpec {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  path: string
  tags: string[]
  description?: string
  security?: boolean
  body?: z.ZodType
  query?: z.ZodType
  responses: Record<number, { description: string; schema?: string | z.ZodType; noContent?: boolean }>
}

function registerEndpoint(registry: OpenAPIRegistry, spec: EndpointSpec): void {
  const responses: Record<string, ResponseConfig> = {}
  for (const [status, resp] of Object.entries(spec.responses)) {
    if (resp.noContent) {
      responses[status] = { description: resp.description }
    } else if (typeof resp.schema === 'string') {
      responses[status] = { description: resp.description, content: jsonContent(ref(resp.schema)) }
    } else if (resp.schema) {
      responses[status] = { description: resp.description, content: jsonContent(resp.schema) }
    } else {
      responses[status] = { description: resp.description }
    }
  }
  // Uniform error contract on every endpoint (spec error section).
  responses['400'] ??= { description: 'Validation / bad request', content: jsonContent(ref('Error')) }
  responses['500'] ??= { description: 'Internal error (generic, no internals)', content: jsonContent(ref('Error')) }

  registry.registerPath({
    method: spec.method,
    path: spec.path,
    tags: spec.tags,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.security ? { security: [{ bearerAuth: [] }] } : {}),
    request: {
      ...(spec.body ? { body: { content: jsonContent(spec.body) } } : {}),
      ...(spec.query ? { query: spec.query as z.ZodObject<z.ZodRawShape> } : {}),
    },
    responses,
  })
}

/** Registers every v1 endpoint (spec API contract table) from the module DTOs. */
export function buildOpenApiDocument(config: {
  title: string
  version: string
  description: string
}): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const registry = new OpenAPIRegistry()

  // --- auth / users ---
  registry.register('LoginInput', loginSchema)
  registry.register('CreateUserInput', createUserSchema)
  registry.register('UpdateUserInput', updateUserSchema)
  registry.register('PatchMeInput', patchMeSchema)
  registry.register('User', userSchema)
  registry.register('UserList', listEnvelope(userSchema))
  registry.register('Error', errorSchema)
  registry.register('UserLoginResult', z.object({ user: userSchema, accessToken: z.string() }))

  registerEndpoint(registry, {
    method: 'post',
    path: '/api/auth/login',
    tags: ['auth'],
    description: 'Login: returns {user, accessToken} and sets the refresh cookie (public)',
    body: loginSchema,
    responses: {
      200: { description: 'Authenticated', schema: 'UserLoginResult' },
      401: { description: 'Identical 401 (no enumeration)' },
    },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/auth/refresh',
    tags: ['auth'],
    description: 'Rotates the refresh cookie and returns a new access token (public, cookie)',
    responses: { 200: { description: 'New token pair' }, 401: { description: 'Invalid/rotated/reused refresh' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/auth/logout',
    tags: ['auth'],
    description: 'Invalidates the presented refresh token (idempotent)',
    security: true,
    responses: { 204: { description: 'Logged out', noContent: true } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/auth/me',
    tags: ['auth'],
    security: true,
    responses: { 200: { description: 'Current user', schema: 'User' } },
  })
  registerEndpoint(registry, {
    method: 'patch',
    path: '/api/auth/me',
    tags: ['auth'],
    description: 'Self-service locale (R-BE-4): {locale} es|en — auth required, 422 invalid',
    security: true,
    body: patchMeSchema,
    responses: { 200: { description: 'Updated user', schema: 'User' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/users',
    tags: ['users'],
    description: 'Admin-only user creation (auth:user_create)',
    security: true,
    body: createUserSchema,
    responses: { 201: { description: 'User created', schema: 'User' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/users',
    tags: ['users'],
    security: true,
    query: usersListQuerySchema,
    responses: { 200: { description: 'Paginated users', schema: 'UserList' } },
  })
  registerEndpoint(registry, {
    method: 'patch',
    path: '/api/users/{id}',
    tags: ['users'],
    security: true,
    body: updateUserSchema,
    responses: { 200: { description: 'User updated', schema: 'User' } },
  })

  // --- crm ---
  registry.register('CreateCustomerInput', createCustomerSchema)
  registry.register('UpdateCustomerInput', updateCustomerSchema)
  registry.register('Customer', customerSchema)
  registry.register('CustomerList', listEnvelope(customerSchema))

  registerEndpoint(registry, {
    method: 'post',
    path: '/api/customers',
    tags: ['crm'],
    security: true,
    body: createCustomerSchema,
    responses: { 201: { description: 'Customer created', schema: 'Customer' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/customers',
    tags: ['crm'],
    security: true,
    query: customersListQuerySchema,
    responses: { 200: { description: 'Paginated customers', schema: 'CustomerList' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/customers/{id}',
    tags: ['crm'],
    security: true,
    responses: { 200: { description: 'Customer detail', schema: 'Customer' } },
  })
  registerEndpoint(registry, {
    method: 'patch',
    path: '/api/customers/{id}',
    tags: ['crm'],
    security: true,
    body: updateCustomerSchema,
    responses: { 200: { description: 'Customer updated', schema: 'Customer' } },
  })

  // --- orders ---
  registry.register('CreateOrderInput', createOrderSchema)
  registry.register('CancelOrderInput', cancelOrderSchema)
  registry.register('Order', orderSchema)
  registry.register('OrderList', listEnvelope(orderSchema))
  registry.register('Money', money)

  registerEndpoint(registry, {
    method: 'post',
    path: '/api/orders',
    tags: ['orders'],
    description: 'Creates a draft order; Idempotency-Key header replays the original (R-ORD-4)',
    security: true,
    body: createOrderSchema,
    responses: { 201: { description: 'Order created', schema: 'Order' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/orders',
    tags: ['orders'],
    security: true,
    query: ordersListQuerySchema,
    responses: { 200: { description: 'Paginated orders', schema: 'OrderList' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/orders/{id}',
    tags: ['orders'],
    security: true,
    responses: { 200: { description: 'Order detail with lines', schema: 'Order' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/orders/{id}/confirm',
    tags: ['orders'],
    description: 'Atomic confirm: stock out-movements + audit + notifications + email jobs in ONE tx (§3.1)',
    security: true,
    responses: { 200: { description: 'Order confirmed', schema: 'Order' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/orders/{id}/cancel',
    tags: ['orders'],
    description: 'Cancels the order; reason >= 10 chars; never reverses stock (R-ORD-6)',
    security: true,
    body: cancelOrderSchema,
    responses: { 200: { description: 'Order cancelled', schema: 'Order' } },
  })

  // --- stock ---
  registry.register('CreateProductInput', createProductSchema)
  registry.register('CreateWarehouseInput', createWarehouseSchema)
  registry.register('CreateMovementInput', movementCreateSchema)
  registry.register('CreateTransferInput', transferCreateSchema)
  registry.register('Product', productSchema)
  registry.register('Warehouse', warehouseSchema)
  registry.register('WarehouseList', listEnvelope(warehouseSchema))
  registry.register('StockLevel', stockLevelSchema)
  // GET /api/stock returns {items} (Batch C contract — no pagination envelope).
  registry.register('StockLevelList', z.object({ items: z.array(stockLevelSchema) }))
  registry.register('Movement', movementSchema)
  registry.register('MovementList', listEnvelope(movementSchema))
  registry.register('ProductList', listEnvelope(productSchema))

  registerEndpoint(registry, {
    method: 'get',
    path: '/api/products',
    tags: ['stock'],
    security: true,
    query: productsListQuerySchema,
    responses: { 200: { description: 'Paginated products', schema: 'ProductList' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/products',
    tags: ['stock'],
    security: true,
    body: createProductSchema,
    responses: { 201: { description: 'Product created', schema: 'Product' } },
  })
  registerEndpoint(registry, {
    method: 'patch',
    path: '/api/products/{id}',
    tags: ['stock'],
    description: 'Edit name/sku/lowStockThreshold/active (≥1 field); 409 DUPLICATE_SKU; active:false deactivates (R-UI-CRM-7)',
    security: true,
    body: updateProductSchema,
    responses: { 200: { description: 'Product updated', schema: 'Product' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/warehouses',
    tags: ['stock'],
    security: true,
    body: createWarehouseSchema,
    responses: { 201: { description: 'Warehouse created', schema: 'Warehouse' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/warehouses',
    tags: ['stock'],
    description: 'Paginated warehouse list (stock:stock_read — adjust/transfer pickers)',
    security: true,
    query: warehousesListQuerySchema,
    responses: { 200: { description: 'Paginated warehouses', schema: 'WarehouseList' } },
  })
  registerEndpoint(registry, {
    method: 'patch',
    path: '/api/warehouses/{id}',
    tags: ['stock'],
    description: 'Warehouse rename (stock:product_manage); 409 CONFLICT duplicate name',
    security: true,
    body: updateWarehouseSchema,
    responses: { 200: { description: 'Warehouse renamed', schema: 'Warehouse' } },
  })
  registerEndpoint(registry, {
    method: 'delete',
    path: '/api/warehouses/{id}',
    tags: ['stock'],
    description: 'Delete warehouse — 204 only when no movement references it, else 409 WAREHOUSE_IN_USE (R-UI-CRM-8)',
    security: true,
    responses: { 204: { description: 'Deleted', noContent: true } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/stock',
    tags: ['stock'],
    security: true,
    query: stockQuerySchema,
    responses: { 200: { description: 'Derived stock levels', schema: 'StockLevelList' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/stock/movements',
    tags: ['stock'],
    security: true,
    query: movementsListQuerySchema,
    responses: { 200: { description: 'Paginated movement history (newest-first)', schema: 'MovementList' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/stock/movements',
    tags: ['stock'],
    security: true,
    body: movementCreateSchema,
    responses: { 201: { description: 'Adjustment recorded', schema: 'Movement' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/stock/transfers',
    tags: ['stock'],
    security: true,
    body: transferCreateSchema,
    responses: { 201: { description: 'Transfer recorded (2 ledger rows)', schema: 'Movement' } },
  })

  // --- notifications ---
  registry.register('Notification', notificationSchema)
  registry.register('NotificationList', listEnvelope(notificationSchema))
  registry.register('NotificationType', z.enum(notificationTypeValues()))

  registerEndpoint(registry, {
    method: 'get',
    path: '/api/notifications',
    tags: ['notifications'],
    description: 'Caller in-app notifications only (R-NOT-1)',
    security: true,
    query: notificationsListQuerySchema,
    responses: { 200: { description: 'Paginated own notifications', schema: 'NotificationList' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/notifications/{id}/read',
    tags: ['notifications'],
    description: "Marks the caller's notification read (owner-scoped; 204 idempotent)",
    security: true,
    responses: { 204: { description: 'Marked read', noContent: true } },
  })

  // --- jobs ---
  registry.register('Job', jobSchema)
  registry.register('JobList', listEnvelope(jobSchema))

  registerEndpoint(registry, {
    method: 'get',
    path: '/api/jobs',
    tags: ['jobs'],
    security: true,
    query: jobsListQuerySchema,
    responses: { 200: { description: 'Paginated pg-boss jobs', schema: 'JobList' } },
  })
  registerEndpoint(registry, {
    method: 'post',
    path: '/api/jobs/{id}/retry',
    tags: ['jobs'],
    description: 'Re-drives a dead-lettered job (R-JOB-6)',
    security: true,
    responses: { 200: { description: 'Job requeued', schema: 'Job' } },
  })

  // --- audit ---
  registry.register('AuditEntry', auditEntrySchema)
  registry.register('AuditList', listEnvelope(auditEntrySchema))

  registerEndpoint(registry, {
    method: 'get',
    path: '/api/audit',
    tags: ['audit'],
    description: 'Append-only audit read (R-AUD-4): audit:read = admin/auditor only',
    security: true,
    query: auditListQuerySchema,
    responses: { 200: { description: 'Paginated audit entries (newest-first)', schema: 'AuditList' } },
  })

  // --- observability ---
  registry.register('Health', healthSchema)
  registry.register('Status', statusSchema)

  registerEndpoint(registry, {
    method: 'get',
    path: '/api/health',
    tags: ['observability'],
    description: 'Public liveness for Docker HEALTHCHECK (R-OBS-1)',
    responses: {
      200: { description: 'Healthy', schema: 'Health' },
      503: { description: 'DB unreachable', schema: 'Health' },
    },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/status',
    tags: ['observability'],
    description: 'Readiness: any authenticated user (R-OBS-2, ADR-6)',
    security: true,
    responses: { 200: { description: 'Readiness info', schema: 'Status' } },
  })
  registerEndpoint(registry, {
    method: 'get',
    path: '/api/docs',
    tags: ['observability'],
    description: 'Self-hosted Swagger UI (R-DOC-1, public)',
    responses: { 200: { description: 'Swagger UI HTML' } },
  })

  const generator = new OpenApiGeneratorV3(registry.definitions)
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })
  return generator.generateDocument({
    openapi: API_VERSION,
    info: {
      title: config.title,
      version: config.version,
      description: config.description,
    },
    servers: [{ url: '/' }],
  })
}

// ---------------------------------------------------------------------------
// HTTP serving: /api/docs.json + /api/docs (Swagger UI, offline) + static assets
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)
const SWAGGER_UI_DIR = require('swagger-ui-dist/absolute-path.js')() as string

const UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>BOP v1 — API Documentation</title>
  <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
  <script src="/api/docs/assets/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/api/docs.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
      })
    }
  </script>
</body>
</html>
`

export function createDocsRouter(config: AppConfig): Router {
  const router = Router()
  const doc = buildOpenApiDocument({
    title: 'Business Operations Platform — API',
    version: config.appVersion,
    description:
      'BOP v1: auth/RBAC, CRM, orders (atomic confirm), stock ledger, jobs (pg-boss), notifications, audit, observability.',
  })

  router.get('/docs', (_req, res) => {
    res.type('html').send(UI_HTML)
  })
  router.get('/docs.json', (_req, res) => {
    res.json(doc)
  })
  router.use('/docs/assets', express.static(SWAGGER_UI_DIR))

  return router
}

function notificationTypeValues(): readonly string[] {
  return Object.values(NOTIFICATION_TYPES)
}