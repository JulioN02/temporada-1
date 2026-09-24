import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import type { RolePermission } from '../auth/permissions.ts'

/**
 * Action-level guard (R-RBAC-2): actions are HIDDEN — never merely disabled —
 * when the current role lacks the permission. The server remains the source
 * of truth; this only controls UI visibility.
 */
export function RoleGate({
  permission,
  children,
  fallback = null,
}: {
  permission: RolePermission
  children: ReactNode
  fallback?: ReactNode
}) {
  const { hasPermission } = useAuth()
  return hasPermission(permission) ? children : fallback
}