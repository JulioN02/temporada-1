import { api, buildQuery } from './client.ts'
import type { CreateProductInput, Paginated, Product, UpdateProductInput } from './types.ts'

/** Products API module (it3 catalog). */

export type ProductsListParams = {
  q?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export function listProducts(params: ProductsListParams = {}): Promise<Paginated<Product>> {
  return api.get<Paginated<Product>>(`/api/products${buildQuery(params)}`)
}

export function createProduct(input: CreateProductInput): Promise<{ product: Product }> {
  return api.post<{ product: Product }>('/api/products', input)
}

/** R-UI-CRM-7 (it1 delta): partial update incl. deactivate (`active:false`). */
export function updateProduct(id: string, input: UpdateProductInput): Promise<{ product: Product }> {
  return api.patch<{ product: Product }>(`/api/products/${id}`, input)
}