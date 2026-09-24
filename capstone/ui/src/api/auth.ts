import { api, refreshAccessToken } from './client.ts'
import type { Locale } from '../i18n/types.ts'
import type { LoginResponse, PublicUser } from './types.ts'

/**
 * Auth API module (capstone-ui it2a, T-2-5). Login/refresh are cookie+
 * credential flows — never carry the access token; logout is a raw fetch
 * (works with an expired access token, errors swallowed — design ADR-3).
 */
export interface LoginInput {
  username: string
  password: string
}

export function login(input: LoginInput): Promise<LoginResponse> {
  return api.post<LoginResponse>('/api/auth/login', input)
}

/** Boot-restore seam (it2b AuthProvider): refresh cookie → {user, accessToken} | null. */
export function refresh(): Promise<LoginResponse | null> {
  return refreshAccessToken()
}

export function me(): Promise<{ user: PublicUser }> {
  return api.get<{ user: PublicUser }>('/api/auth/me')
}

/** R-BE-4: self-service locale change (post-auth toggle, it2b wires the UI). */
export function patchMe(locale: Locale): Promise<{ user: PublicUser }> {
  return api.patch<{ user: PublicUser }>('/api/auth/me', { locale })
}

/** R-AUTHUI-3: raw-fetch logout (cookie-only, idempotent 204); errors swallowed. */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    // idempotent — already logged out
  }
}