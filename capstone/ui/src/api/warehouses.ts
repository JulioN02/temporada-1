import { api, buildQuery } from './client.ts'
import type { Paginated, Warehouse } from './types.ts'

/** Warehouses API module (it3 Stock module; it1 delta CRUD). */

export type WarehousesListParams = {
  page?: number | undefined
  limit?: number | undefined
}

export function listWarehouses(params: WarehousesListParams = {}): Promise<Paginated<Warehouse>> {
  return api.get<Paginated<Warehouse>>(`/api/warehouses${buildQuery(params)}`)
}

export function createWarehouse(name: string): Promise<{ warehouse: Warehouse }> {
  return api.post<{ warehouse: Warehouse }>('/api/warehouses', { name })
}

export function renameWarehouse(id: string, name: string): Promise<{ warehouse: Warehouse }> {
  return api.patch<{ warehouse: Warehouse }>(`/api/warehouses/${id}`, { name })
}

/** 204 on success; 409 WAREHOUSE_IN_USE when movements reference it. */
export function deleteWarehouse(id: string): Promise<null> {
  return api.delete<null>(`/api/warehouses/${id}`)
}