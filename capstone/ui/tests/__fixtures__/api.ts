/**
 * API fixtures (capstone-ui it2a, T-2-3) — response bodies mirroring the
 * backend zod/OpenAPI shapes (the contract, R-UI-NFR-6). Used by page and
 * api-client tests through the mock fetch harness; NEVER a live backend.
 */
import type {
  AuditRow,
  Customer,
  Job,
  Movement,
  Notification,
  Order,
  OrderListItem,
  Paginated,
  Product,
  PublicUser,
  StockRow,
  Warehouse,
} from '../../src/api/types.ts'

export const userFixture: PublicUser = {
  id: '1',
  username: 'admin',
  fullName: 'Admin User',
  email: 'admin@bop.local',
  role: 'admin',
  active: true,
  locale: 'es',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export function loginResponseFixture(overrides: Partial<PublicUser> = {}): {
  user: PublicUser
  accessToken: string
} {
  return { user: { ...userFixture, ...overrides }, accessToken: 'access-token-1' }
}

export function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '10',
    name: 'Ana Ruiz',
    email: 'ana@example.com',
    phone: null,
    notes: null,
    status: 'active',
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

export function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: '20',
    name: 'Widget',
    sku: 'WID-1',
    lowStockThreshold: 2,
    active: true,
    createdAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  }
}

export function warehouseFixture(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: '30',
    name: 'Main WH',
    createdAt: '2026-01-04T00:00:00.000Z',
    ...overrides,
  }
}

export function stockRowFixture(overrides: Partial<StockRow> = {}): StockRow {
  return {
    product_id: '20',
    sku: 'WID-1',
    name: 'Widget',
    warehouse_id: '30',
    warehouse_name: 'Main WH',
    level: '3',
    ...overrides,
  }
}

export function movementFixture(overrides: Partial<Movement> = {}): Movement {
  return {
    id: '40',
    productId: '20',
    warehouseId: '30',
    type: 'adjustment',
    quantity: 5,
    sign: 1,
    reason: 'initial stock',
    idempotencyKey: null,
    createdAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  }
}

export function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: '50',
    customerId: '10',
    state: 'draft',
    total: '3.00',
    createdAt: '2026-01-06T00:00:00.000Z',
    lines: [
      { id: '51', productId: '20', productName: 'Widget', productSku: 'WID-1', qty: 2, unitPrice: '1.50', lineTotal: '3.00' },
    ],
    ...overrides,
  }
}

export function orderListItemFixture(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: '50',
    customerId: '10',
    state: 'draft',
    total: '3.00',
    createdAt: '2026-01-06T00:00:00.000Z',
    ...overrides,
  }
}

export function notificationFixture(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '60',
    type: 'order_confirmed',
    channel: 'in_app',
    title: 'Pedido confirmado',
    body: 'El pedido 50 fue confirmado.',
    reference: 'order:50:confirmed',
    readAt: null,
    deliveryState: 'delivered',
    createdAt: '2026-01-07T00:00:00.000Z',
    ...overrides,
  }
}

export function auditRowFixture(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: '70',
    action: 'customer.create',
    entity: 'customer',
    entity_id: '10',
    actor_id: '1',
    actor_username: 'admin',
    payload: { name: 'Ana Ruiz', outcome: 'success' },
    created_at: '2026-01-08T00:00:00.000Z',
    ...overrides,
  }
}

export function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    id: '80',
    queue: 'report.queue',
    state: 'completed',
    retryCount: 0,
    retryLimit: 3,
    notificationId: null,
    createdAt: '2026-01-09T00:00:00.000Z',
    completedAt: '2026-01-09T00:01:00.000Z',
    ...overrides,
  }
}

/** Standard pagination envelope for list fixtures. */
export function paginated<T>(data: T[], total = data.length): Paginated<T> {
  return { data, pagination: { page: 1, limit: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) } }
}

/** Uniform backend error body. */
export function errorFixture(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } }
}