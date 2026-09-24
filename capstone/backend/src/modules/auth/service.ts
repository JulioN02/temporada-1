import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import { ApiError, isUniqueViolation } from '../../middleware/errorHandler.ts'
import type { Db } from '../../db/pool.ts'
import { withTransaction } from '../../db/transaction.ts'
import { writeAudit, writeAuditBestEffort } from '../audit/write.ts'
import { emitEvent } from '../notifications/emit.ts'
import { NOTIFICATION_TYPES } from '../notifications/types.ts'
import type { Role } from '../../permissions/registry.ts'
import type { CreateUserInput, LoginInput, UpdateUserInput } from './dto.ts'
import * as authRepo from './repository.ts'

export const BCRYPT_COST = 10 // R-AUTH-6: bcrypt cost 10
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60 // R-AUTH-3: 15 min
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60 // R-AUTH-4: 7 days

/** Timing parity for unknown-user logins (R-AUTH-2 dummy bcrypt compare). */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomUUID(), BCRYPT_COST)

/** Optional request context recorded on auth audit payloads (ip only — R-AUD-3). */
export interface AuthMeta {
  ip?: string | null
  userAgent?: string | null
  /** Acting user identity (for admin-driven mutations like user.create/update). */
  actorId?: string | null
  actorUsername?: string | null
}

export interface PublicUser {
  id: string
  username: string
  fullName: string | null
  email: string
  role: Role
  active: boolean
  locale: string
  createdAt: string
}

export function toPublicUser(user: authRepo.UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    active: user.active,
    locale: user.locale,
    createdAt: new Date(user.created_at).toISOString(),
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function signAccessToken(
  user: { id: string; username: string; role: Role },
  secret: string,
): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, typ: 'access', jti: crypto.randomUUID() },
    secret,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  )
}

export function signRefreshToken(
  payload: { sub: string; jti: string; fam: string },
  secret: string,
): string {
  return jwt.sign({ sub: payload.sub, jti: payload.jti, fam: payload.fam, typ: 'refresh' }, secret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  })
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

async function issueTokenPair(
  db: Db,
  user: authRepo.UserRecord,
  secret: string,
): Promise<TokenPair> {
  const jti = crypto.randomUUID()
  const familyId = crypto.randomUUID()
  const rawRefresh = signRefreshToken({ sub: user.id, jti, fam: familyId }, secret)
  await authRepo.insertRefreshToken(db, {
    id: jti,
    userId: user.id,
    familyId,
    tokenHash: sha256Hex(rawRefresh), // R-NFR-5: SHA-256 hash at rest, never the raw token
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  })
  return { accessToken: signAccessToken(user, secret), refreshToken: rawRefresh }
}

/** True when `db` is a bare Pool (no transaction in flight) — callers wrap it. */
function isPool(db: Db): db is Pool {
  return typeof (db as Pool).connect === 'function'
}

/**
 * R-AUTH-1: admin-only user creation (enforced by requirePermission on the
 * route). T-5-9 (S4): the WHOLE create — user row + user.create audit +
 * `user_invited` email notification + job enqueue — runs in ONE transaction
 * (atomic, commit-all or rollback-all; the invite email row and job vanish
 * with a failed insert). user_invited is email-only (R-NOT-2) and the
 * template never includes the password (R-NOT-5).
 */
export async function createUser(
  db: Db,
  input: CreateUserInput,
  meta: AuthMeta | undefined,
  enqueuer: PgBoss,
): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password)
  const run = async (client: Db): Promise<PublicUser> => {
    const user = await authRepo.insertUserWithRole(
      client,
      { username: input.username, fullName: input.fullName ?? null, email: input.email, passwordHash },
      input.role,
    )
    await writeAudit(client, {
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      actorId: meta?.actorId ?? null,
      actorUsername: meta?.actorUsername ?? null,
      payload: { username: user.username, role: user.role, outcome: 'success' },
    })
    await emitEvent(
      client,
      {
        type: NOTIFICATION_TYPES.userInvited,
        reference: `user:${user.id}:invite`,
        payload: {
          username: user.username,
          fullName: user.full_name ?? null,
          email: user.email,
        },
        recipientUserIds: [user.id],
      },
      enqueuer,
    )
    return toPublicUser(user)
  }
  try {
    return isPool(db) ? await withTransaction(db, run) : await run(db)
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'Username or email already in use')
    }
    throw err
  }
}

/**
 * R-AUTH-2: login with identical 401 (no enumeration). Unknown username runs
 * a dummy bcrypt compare for timing parity; inactive users get the same 401.
 */
export async function login(
  db: Db,
  input: LoginInput,
  secret: string,
  meta?: AuthMeta,
): Promise<{ user: PublicUser } & TokenPair> {
  const user = await authRepo.findByUsername(db, input.username)
  const passwordOk = user ? await bcrypt.compare(input.password, user.password_hash) : false
  if (!user || !passwordOk || !user.active) {
    if (!user) {
      await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH) // timing parity
    }
    await writeAuditBestEffort(db, {
      action: 'auth.login.failure',
      entity: 'user',
      entityId: user?.id ?? null,
      actorId: user?.id ?? null,
      actorUsername: user?.username ?? null,
      payload: { actor: input.username, outcome: 'failure', ip: meta?.ip ?? null },
    })
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid username or password')
  }
  const tokens = await issueTokenPair(db, user, secret)
  await writeAuditBestEffort(db, {
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
    actorId: user.id,
    actorUsername: user.username,
    // R-AUD-3: actor/ip only — NO credentials, hashes or token material.
    payload: { actor: user.username, outcome: 'success', ip: meta?.ip ?? null },
  })
  return { user: toPublicUser(user), ...tokens }
}

export interface RefreshResult extends TokenPair {
  user: PublicUser
}

type RotationOutcome =
  | { kind: 'ok'; user: authRepo.UserRecord; accessToken: string; refreshToken: string }
  | { kind: 'reuse' }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'deactivated' }

/**
 * R-AUTH-4: rotation with reuse detection — family invalidation on replay.
 * The whole read → revoke → insert rotation runs inside ONE transaction
 * (`FOR UPDATE SKIP LOCKED`): a concurrent refresh of the same token finds no
 * row → 401 invalid without touching the family; a true sequential replay
 * finds the row unlocked but revoked → reuse branch → family invalidated.
 */
export async function refresh(
  pool: Pool,
  rawToken: string | undefined,
  secret: string,
  meta?: AuthMeta,
): Promise<RefreshResult> {
  if (!rawToken) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token missing')
  }
  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(rawToken, secret) as jwt.JwtPayload
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired refresh token')
  }
  if (
    payload.typ !== 'refresh' ||
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.fam !== 'string'
  ) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token')
  }

  const outcome = await withTransaction<RotationOutcome>(pool, async (client) => {
    const row = await authRepo.findByTokenHashForUpdate(client, sha256Hex(rawToken!))
    if (!row) {
      return { kind: 'invalid' }
    }
    if (row.revoked_at !== null) {
      // Reuse of an already-rotated token → invalidate the ENTIRE family.
      await authRepo.revokeFamily(client, row.family_id)
      await writeAuditBestEffort(client, {
        action: 'auth.refresh.reuse',
        entity: 'refresh_token',
        entityId: row.id,
        actorId: row.user_id,
        actorUsername: null,
        payload: { familyId: row.family_id, outcome: 'family_invalidated', ip: meta?.ip ?? null },
      })
      return { kind: 'reuse' }
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await authRepo.revokeToken(client, row.id, null)
      return { kind: 'expired' }
    }

    const user = await authRepo.findById(client, row.user_id)
    if (!user) {
      return { kind: 'invalid' }
    }
    if (!user.active) {
      await authRepo.revokeToken(client, row.id, null)
      return { kind: 'deactivated' }
    }

    // Rotate: revoke old row (replaced_by = new jti), insert new row same family.
    const newJti = crypto.randomUUID()
    const revoked = await authRepo.revokeToken(client, row.id, newJti)
    if (!revoked) {
      await authRepo.revokeFamily(client, row.family_id)
      return { kind: 'reuse' }
    }
    const newRaw = signRefreshToken({ sub: user.id, jti: newJti, fam: row.family_id }, secret)
    await authRepo.insertRefreshToken(client, {
      id: newJti,
      userId: user.id,
      familyId: row.family_id,
      tokenHash: sha256Hex(newRaw),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    })
    return {
      kind: 'ok',
      user,
      accessToken: signAccessToken(user, secret),
      refreshToken: newRaw,
    }
  })

  if (outcome.kind === 'ok') {
    return { user: toPublicUser(outcome.user), accessToken: outcome.accessToken, refreshToken: outcome.refreshToken }
  }
  switch (outcome.kind) {
    case 'reuse':
      throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token has been reused')
    case 'expired':
      throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token expired')
    case 'deactivated':
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired refresh token')
    default:
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token')
  }
}

/** R-AUTH-5: logout — idempotent, revokes the presented refresh row. */
export async function logout(
  db: Db,
  rawToken: string | undefined,
  meta?: AuthMeta,
): Promise<void> {
  if (!rawToken) return
  const userId = await authRepo.revokeByTokenHash(db, sha256Hex(rawToken))
  if (userId) {
    await writeAuditBestEffort(db, {
      action: 'auth.logout',
      entity: 'user',
      entityId: userId,
      actorId: userId,
      actorUsername: null,
      payload: { outcome: 'success', ip: meta?.ip ?? null },
    })
  }
}

/** GET /api/auth/me — fresh user from the DB (role changes reflected). */
export async function me(db: Db, userId: string): Promise<PublicUser> {
  const user = await authRepo.findById(db, userId)
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token')
  }
  return toPublicUser(user)
}

/**
 * R-BE-4 (capstone-ui it1): PATCH /api/auth/me — self-service locale change.
 * The DTO whitelist ('es'|'en') already rejected invalid values; a missing
 * user row is impossible for an authenticated caller but guarded anyway.
 */
export async function updateMyLocale(db: Db, userId: string, locale: string): Promise<PublicUser> {
  const user = await authRepo.updateLocale(db, userId, locale)
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token')
  }
  return toPublicUser(user)
}

/** PATCH /api/users/:id — role / active / password (admin-only route). */
export async function updateUser(
  db: Db,
  id: string,
  input: UpdateUserInput,
  meta?: AuthMeta,
): Promise<PublicUser> {
  const updates: authRepo.UpdateUserInput = {}
  if (input.role !== undefined) updates.role = input.role
  if (input.active !== undefined) updates.active = input.active
  if (input.password !== undefined) updates.passwordHash = await hashPassword(input.password)

  const user = await authRepo.updateUser(db, id, updates)
  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found')
  }
  await writeAuditBestEffort(db, {
    action: 'user.update',
    entity: 'user',
    entityId: user.id,
    actorId: meta?.actorId ?? null,
    actorUsername: meta?.actorUsername ?? null,
    payload: { username: user.username, role: user.role, active: user.active, outcome: 'success' },
  })
  return toPublicUser(user)
}

export interface UsersListResult {
  items: PublicUser[]
  total: number
}

export async function listUsers(
  db: Db,
  opts: { page: number; pageSize: number },
): Promise<UsersListResult> {
  const result = await authRepo.listUsers(db, opts)
  return { items: result.items.map(toPublicUser), total: result.total }
}