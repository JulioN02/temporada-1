import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { AppConfig } from '../../config/env.ts'
import { parseOrThrow } from '../../middleware/validate.ts'
import type { CreateUserInput, LoginInput, PatchMeInput, UpdateUserInput, UsersListQuery } from './dto.ts'
import { usersListQuerySchema } from './dto.ts'
import * as authService from './service.ts'
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookies.ts'

export interface AuthController {
  login: (req: Request, res: Response) => Promise<void>
  refresh: (req: Request, res: Response) => Promise<void>
  logout: (req: Request, res: Response) => Promise<void>
  me: (req: Request, res: Response) => Promise<void>
  patchMe: (req: Request, res: Response) => Promise<void>
  createUser: (req: Request, res: Response) => Promise<void>
  listUsers: (req: Request, res: Response) => Promise<void>
  updateUser: (req: Request, res: Response) => Promise<void>
}

/** Orchestration only — every endpoint stays under 15 lines (R-NFR-4). */
export function createAuthController(deps: { db: Pool; config: AppConfig; boss: PgBoss }): AuthController {
  const { db, config, boss } = deps

  /** Request context for audit rows: ip + acting identity (never credentials). */
  function meta(req: Request): authService.AuthMeta {
    return {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      actorId: req.user?.id ?? null,
      actorUsername: req.user?.username ?? null,
    }
  }

  async function login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(db, req.body as LoginInput, config.jwtSecret, meta(req))
    setRefreshCookie(res, result.refreshToken, config)
    res.json({ user: result.user, accessToken: result.accessToken })
  }

  async function refresh(req: Request, res: Response): Promise<void> {
    const result = await authService.refresh(db, readRefreshCookie(req), config.jwtSecret, meta(req))
    setRefreshCookie(res, result.refreshToken, config)
    res.json({ user: result.user, accessToken: result.accessToken })
  }

  async function logout(req: Request, res: Response): Promise<void> {
    await authService.logout(db, readRefreshCookie(req), meta(req))
    clearRefreshCookie(res, config)
    res.status(204).end()
  }

  async function me(req: Request, res: Response): Promise<void> {
    const user = await authService.me(db, req.user!.id)
    res.json({ user })
  }

  /** R-BE-4: self-service locale — validated by patchMeSchema (422 on invalid). */
  async function patchMe(req: Request, res: Response): Promise<void> {
    const user = await authService.updateMyLocale(db, req.user!.id, (req.body as PatchMeInput).locale)
    res.json({ user })
  }

  async function createUser(req: Request, res: Response): Promise<void> {
    const user = await authService.createUser(db, req.body as CreateUserInput, meta(req), boss)
    res.status(201).json({ user })
  }

  async function listUsers(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<UsersListQuery>(usersListQuerySchema, req.query)
    const result = await authService.listUsers(db, { page: query.page, pageSize: query.limit })
    res.json({
      data: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
      },
    })
  }

  async function updateUser(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })
      return
    }
    const user = await authService.updateUser(db, id, req.body as UpdateUserInput, meta(req))
    res.json({ user })
  }

  return { login, refresh, logout, me, patchMe, createUser, listUsers, updateUser }
}