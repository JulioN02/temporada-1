import bcrypt from 'bcryptjs'
import type { Pool } from 'pg'
import type { Express } from 'express'
import request from 'supertest'

export interface CreatedUser {
  id: string
}

export const TEST_ROLES = ['admin', 'manager', 'operator', 'viewer', 'auditor'] as const
export type TestRole = (typeof TEST_ROLES)[number]

/**
 * Creates a user directly in the DB with a bcrypt hash and one of the five
 * seeded roles (test bootstrap — F-8 5-role factory).
 */
export async function createUser(
  pool: Pool,
  input: { username: string; email: string; password: string; role: TestRole; fullName?: string },
): Promise<CreatedUser> {
  const hash = await bcrypt.hash(input.password, 10)
  const { rows } = await pool.query(
    `INSERT INTO users (username, full_name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.username, input.fullName ?? null, input.email, hash],
  )
  const user = rows[0] as CreatedUser
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`,
    [user.id, input.role],
  )
  return user
}

/** Logs in via the real API and returns the access token. */
export async function loginAndGetToken(
  app: Express,
  username: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password })
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.accessToken as string
}

/** Bootstrap: admin user + real API login. Returns the access token. */
export async function adminToken(
  app: Express,
  pool: Pool,
  username = 'admin',
  password = 'AdminPass123',
): Promise<string> {
  await createUser(pool, { username, email: 'admin@test.local', password, role: 'admin' })
  return loginAndGetToken(app, username, password)
}