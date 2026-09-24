import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import { LoadingState } from './LoadingState.tsx'

/**
 * Route guard (R-AUTHUI-4): waits for boot session restore (loading state —
 * no login flash), then redirects anonymous users to `/login` preserving the
 * intended route via `?next=`. Wraps the Layout (and therefore every module
 * route) in App.tsx.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return <LoadingState />
  }

  if (!user) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return children
}