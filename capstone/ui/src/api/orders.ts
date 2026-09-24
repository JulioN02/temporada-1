import { api, buildQuery } from './client.ts'
import type { CreateOrderInput, Order, OrderListItem, OrderState, Paginated } from './types.ts'

/** Orders API module (it4 showpiece). Idempotent mutations carry a fresh key. */

export type OrdersListParams = {
  status?: OrderState | undefined
  customerId?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export function listOrders(params: OrdersListParams = {}): Promise<Paginated<OrderListItem>> {
  return api.get<Paginated<OrderListItem>>(`/api/orders${buildQuery(params)}`)
}

export function getOrder(id: string): Promise<{ order: Order }> {
  return api.get<{ order: Order }>(`/api/orders/${id}`)
}

/** R-ORD-1/6: create with a fresh Idempotency-Key; replay 200 ≠ 201. */
export function createOrder(
  input: CreateOrderInput,
  idempotencyKey: string,
): Promise<{ status: number; data: { order: Order } }> {
  return api.postWithStatus<{ order: Order }>('/api/orders', input, {
    'Idempotency-Key': idempotencyKey,
  })
}

/** R-ORD-5 (atomic confirm): fresh Idempotency-Key per submit. */
export function confirmOrder(
  id: string,
  idempotencyKey: string,
): Promise<{ status: number; data: { order: Order } }> {
  return api.postWithStatus<{ order: Order }>(`/api/orders/${id}/confirm`, {}, { 'Idempotency-Key': idempotencyKey })
}

/** R-ORD-3: cancel with a reason ≥10 chars (server enforces). */
export function cancelOrder(id: string, reason: string): Promise<{ order: Order }> {
  return api.post<{ order: Order }>(`/api/orders/${id}/cancel`, { reason })
}