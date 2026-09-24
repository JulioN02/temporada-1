import { api, buildQuery } from './client.ts'
import type { Paginated, PublicUser, Role } from './types.ts'

/** Users API module (it5 governance; admin-only endpoints). */

export type UsersListParams = {
  page?: number | undefined
  limit?: number | undefined
}

export interface CreateUserInput {
  username: string
  fullName?: string | undefined
  email: string
  role: Role
  password: string
}

export interface UpdateUserInput {
  role?: Role | undefined
  active?: boolean | undefined
  password?: string | undefined
}

export function listUsers(params: UsersListParams = {}): Promise<Paginated<PublicUser>> {
  return api.get<Paginated<PublicUser>>(`/api/users${buildQuery(params)}`)
}

export function createUser(input: CreateUserInput): Promise<{ user: PublicUser }> {
  return api.post<{ user: PublicUser }>('/api/users', input)
}

export function updateUser(id: string, input: UpdateUserInput): Promise<{ user: PublicUser }> {
  return api.patch<{ user: PublicUser }>(`/api/users/${id}`, input)
}