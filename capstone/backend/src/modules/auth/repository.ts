import type { Db } from '../../db/pool.ts'
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../permissions/registry.ts'

/**
 * Auth repository (T-1-3) — the ONLY DB access layer for users, refresh
 * tokens and role lookup. Refresh tokens are stored as SHA-256 hashes only
 * (R-NFR-5); the per-request permission check (R-AUTH-8) resolves the caller's
 * role from the DB on every request — never from the token.
 */

export interface UserRecord {
  id: string
  username: string
  full_name: string | null
  email: string
  password_hash: string
  active: boolean
  locale: string
  role: Role
  created_at: Date
}

export interface RefreshTokenRecord {
  id: string
  user_id: string
  family_id: string
  token_hash: string
  expires_at: Date
  revoked_at: Date | null
  replaced_by: string | null
}

const USER_COLUMNS = `
  u.id, u.username, u.full_name, u.email, u.password_hash, u.active, u.locale,
  u.created_at, r.code AS role
`

/** Inserts a user with its role in one unit (no partial user). */
export async function insertUserWithRole(
  db: Db,
  input: { username: string; fullName: string | null; email: string; passwordHash: string },
  role: Role,
): Promise<UserRecord> {
  const { rows } = await db.query(
    `INSERT INTO users (username, full_name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, full_name, email, password_hash, active, locale, created_at`,
    [input.username, input.fullName, input.email, input.passwordHash],
  )
  const user = rows[0] as Omit<UserRecord, 'role'>
  await db.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`,
    [user.id, role],
  )
  return { ...user, role }
}

export async function findByUsername(db: Db, username: string): Promise<UserRecord | null> {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.username = $1`,
    [username],
  )
  return (rows[0] as UserRecord | undefined) ?? null
}

export async function findById(db: Db, id: string): Promise<UserRecord | null> {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1`,
    [id],
  )
  return (rows[0] as UserRecord | undefined) ?? null
}

/**
 * R-AUTH-8: per-request permission check. Resolves the caller's CURRENT role
 * from the DB (mid-session role changes take effect without token re-issue);
 * the role → permission matrix is the const registry (parity-tested R-AUTH-7).
 */
export async function hasPermission(
  db: Db,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT r.code FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId],
  )
  const row = rows[0] as { code: string } | undefined
  if (!row) return false
  const permissions = ROLE_PERMISSIONS[row.code as Role]
  return permissions !== undefined && permissions.includes(permission)
}

export interface InsertRefreshTokenInput {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  expiresAt: Date
}

export async function insertRefreshToken(
  db: Db,
  input: InsertRefreshTokenInput,
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.userId, input.familyId, input.tokenHash, input.expiresAt],
  )
}

/**
 * Locks the refresh-token row for the rotation transaction. `FOR UPDATE SKIP
 * LOCKED` makes concurrent refreshes of the SAME token fail fast (no row →
 * 401) while the winner's transaction is open; a genuine sequential replay
 * reads the revoked row → reuse branch → family invalidation (R-AUTH-4).
 */
export async function findByTokenHashForUpdate(
  db: Db,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const { rows } = await db.query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE SKIP LOCKED`,
    [tokenHash],
  )
  return (rows[0] as RefreshTokenRecord | undefined) ?? null
}

/** Rotates: revokes the old row and records which jti replaced it. False when already revoked. */
export async function revokeToken(db: Db, id: string, replacedBy: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [id, replacedBy],
  )
  return rows.length > 0
}

/** Reuse detection: invalidates every still-active token of the family (R-AUTH-4). */
export async function revokeFamily(db: Db, familyId: string): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  )
}

/** Revokes the active row for a token hash. Returns the owner user id or null. */
export async function revokeByTokenHash(db: Db, tokenHash: string): Promise<string | null> {
  const { rows } = await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING user_id`,
    [tokenHash],
  )
  return (rows[0] as { user_id: string } | undefined)?.user_id ?? null
}

export interface UserListResult {
  items: UserRecord[]
  total: number
}

export async function listUsers(
  db: Db,
  opts: { page: number; pageSize: number },
): Promise<UserListResult> {
  const offset = (opts.page - 1) * opts.pageSize
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM users`)
  const data = await db.query(
    `SELECT ${USER_COLUMNS}
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     ORDER BY u.id
     LIMIT $1 OFFSET $2`,
    [opts.pageSize, offset],
  )
  return {
    items: data.rows as UserRecord[],
    total: (count.rows[0] as { total: number }).total,
  }
}

export interface UpdateUserInput {
  role?: Role
  active?: boolean
  passwordHash?: string
}

/**
 * R-BE-4 (capstone-ui it1): self-service locale update. The whitelist lives in
 * the DTO (patchMeSchema) — this repository function only writes the caller's
 * own row. Returns null when the user does not exist.
 */
export async function updateLocale(
  db: Db,
  id: string,
  locale: string,
): Promise<UserRecord | null> {
  const { rows } = await db.query(
    `UPDATE users SET locale = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [id, locale],
  )
  if (rows.length === 0) return null
  return findById(db, id)
}

/** Updates role / active / password (at least one field). Returns null when unknown id. */
export async function updateUser(
  db: Db,
  id: string,
  input: UpdateUserInput,
): Promise<UserRecord | null> {
  const sets: string[] = ['updated_at = now()']
  const values: unknown[] = []
  if (input.active !== undefined) {
    values.push(input.active)
    sets.push(`active = $${values.length}`)
  }
  if (input.passwordHash !== undefined) {
    values.push(input.passwordHash)
    sets.push(`password_hash = $${values.length}`)
  }
  values.push(id)
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
    values,
  )
  if (rows.length === 0) return null

  if (input.role !== undefined) {
    await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [id])
    await db.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`,
      [id, input.role],
    )
  }
  return findById(db, id)
}