import { api, buildQuery } from './client.ts'
import type { CreateCustomerInput, Customer, CustomerStatus, Paginated, UpdateCustomerInput } from './types.ts'

/** Customers API module (it3 CRM). */

export type CustomersListParams = {
  q?: string | undefined
  status?: CustomerStatus | undefined
  page?: number | undefined
  limit?: number | undefined
}

export function listCustomers(params: CustomersListParams = {}): Promise<Paginated<Customer>> {
  return api.get<Paginated<Customer>>(`/api/customers${buildQuery(params)}`)
}

export function getCustomer(id: string): Promise<{ customer: Customer }> {
  return api.get<{ customer: Customer }>(`/api/customers/${id}`)
}

export function createCustomer(input: CreateCustomerInput): Promise<{ customer: Customer }> {
  return api.post<{ customer: Customer }>('/api/customers', input)
}

export function updateCustomer(id: string, input: UpdateCustomerInput): Promise<{ customer: Customer }> {
  return api.patch<{ customer: Customer }>(`/api/customers/${id}`, input)
}