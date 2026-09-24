import { createContext, useEffect, useState } from 'react'
import { use } from 'react'
import type { ReactNode } from 'react'
import * as authApi from '../api/auth.ts'
import { setAccessToken, setSessionExpiredHandler } from '../api/client.ts'
import type { PublicUser } from '../api/types.ts'
import { roleHasPermission } from './permissions.ts'
import type { RolePermission } from './permissions.ts'

/**
 * Auth session (capstone-ui it2b, T-2-6 — design ADR-3).
 *
 * - Boot restore: on mount, ONE round trip to `POST /api/auth/refresh`
 *   (httpOnly cookie → `{user, accessToken}` — R-AUTHUI-4). Success → token +
 *   user set; failure → anonymous. `initializing` gates ProtectedRoute so no
 *   login flash occurs.
 * - Session-expired wiring: the client's bounded 401→refresh→retry path
 *   invokes `onSessionExpired` on refresh failure; this handler clears memory
 *   state so ProtectedRoute redirects to `/login` (no loop by construction).
 * - Logout (R-AUTHUI-3): raw-fetch `POST /api/auth/logout` FIRST (cookie-only,
 *   works with an expired access token, errors swallowed) THEN clear memory.
 * - Tokens stay memory-only (R-AUTHUI-2) — the client module owns the token.
 */
export interface AuthContextValue {
  user: PublicUser | null
  initializing: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  hasPermission: (permission: RolePermission) => boolean
  /**
   * Mid-session identity refresh (R-RBAC-4, design ADR-6): re-fetches
   * `GET /api/auth/me` and re-renders the user payload — a role demotion /
   * promotion applied by an admin takes effect on the next call without
   * re-login. Failures are SILENT (keep the last known identity; the next
   * successful refresh self-heals) — never a crash, never a session wipe.
   */
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let cancelled = false

    setSessionExpiredHandler(() => {
      setAccessToken(null)
      setUser(null)
    })

    // Boot restore — single round trip (R-AUTHUI-4); the client's
    // refreshAccessToken already stores the fresh token on success.
    void (async () => {
      const result = await authApi.refresh()
      if (cancelled) return
      if (result) {
        setUser(result.user)
      }
      setInitializing(false)
    })()

    return () => {
      cancelled = true
      setSessionExpiredHandler(null)
    }
  }, [])

  async function login(username: string, password: string): Promise<void> {
    const data = await authApi.login({ username, password })
    setAccessToken(data.accessToken)
    setUser(data.user)
  }

  async function logout(): Promise<void> {
    await authApi.logout()
    setAccessToken(null)
    setUser(null)
  }

  function hasPermission(permission: RolePermission): boolean {
    if (!user) return false
    return roleHasPermission(user.role, permission)
  }

  async function refreshUser(): Promise<void> {
    try {
      const { user: fresh } = await authApi.me()
      setUser(fresh)
    } catch {
      // silent (R-RBAC-4): keep the last known identity; a later successful
      // me() self-heals stale visibility. 401 is handled by the client's
      // bounded refresh path (session-expired → login), never here.
    }
  }

  return (
    <AuthContext.Provider value={{ user, initializing, login, logout, hasPermission, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

/** React 19: `use()` reads the context (react-19 skill — allowed in render). */
export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}