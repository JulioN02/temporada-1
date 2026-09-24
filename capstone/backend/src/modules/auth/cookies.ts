import type { Request, Response } from 'express'
import type { AppConfig } from '../../config/env.ts'

export const REFRESH_COOKIE_NAME = 'refresh_token'

interface CookieOpts {
  httpOnly: boolean
  secure: boolean
  sameSite: 'lax'
  path: string
  signed: boolean
}

function baseCookieOptions(config: AppConfig): CookieOpts {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    signed: true,
  }
}

/** Reads the signed refresh cookie (cookie-parser). */
export function readRefreshCookie(req: Request): string | undefined {
  const value = req.signedCookies?.[REFRESH_COOKIE_NAME]
  return typeof value === 'string' ? value : undefined
}

export function setRefreshCookie(res: Response, token: string, config: AppConfig): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseCookieOptions(config),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (R-AUTH-4)
  })
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  // No `signed` flag on clear — must produce an empty value, not a signed one.
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/api/auth',
  })
}