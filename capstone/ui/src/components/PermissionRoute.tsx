import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import type { RolePermission } from '../auth/permissions.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { showToast } from './ToastProvider.tsx'

/**
 * Permission route guard (R-RBAC-1): a user navigating to a forbidden route
 * is redirected to /dashboard with a localized "no permission" toast — NO API
 * call fires (the UI mirror is the gate; the backend still enforces RBAC).
 * The toast fires once per denied visit (effect keyed on `allowed`, with the
 * message precomputed in render so locale changes never re-toast).
 */
export function PermissionRoute({ permission, children }: { permission: RolePermission; children: ReactNode }) {
  const { hasPermission } = useAuth()
  const { t } = useTranslation()
  const allowed = hasPermission(permission)
  const deniedMessage = t('auth.denied')

  useEffect(() => {
    if (!allowed) {
      showToast('error', deniedMessage)
    }
  }, [allowed])

  if (!allowed) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}