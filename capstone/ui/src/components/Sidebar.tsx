import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import type { RolePermission } from '../auth/permissions.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import type { MessageKey } from '../i18n/types.ts'

/**
 * Sidebar navigation (R-UI-FND-2): lists exactly the modules the current
 * role may access (R-RBAC-3 matrix → module read permission), active route
 * highlighted. `notificationBadge` is the unread-count slot consumed at it5
 * (R-UI-NOT-3). Modules hidden here are ALSO guarded at the route level
 * (PermissionRoute) so they are not reachable by URL.
 */
const NAV_ITEMS: readonly { to: string; label: MessageKey; permission: RolePermission | null }[] = [
  { to: '/dashboard', label: 'nav.dashboard', permission: null },
  { to: '/customers', label: 'nav.customers', permission: 'crm:customer_read' },
  { to: '/products', label: 'nav.products', permission: 'stock:stock_read' },
  { to: '/stock', label: 'nav.stock', permission: 'stock:stock_read' },
  { to: '/orders', label: 'nav.orders', permission: 'orders:order_read' },
  { to: '/notifications', label: 'nav.notifications', permission: 'notification:read' },
  { to: '/audit', label: 'nav.audit', permission: 'audit:read' },
  { to: '/users', label: 'nav.users', permission: 'auth:user_read' },
  { to: '/jobs', label: 'nav.jobs', permission: 'jobs:job_read' },
]

export function Sidebar({ notificationBadge }: { notificationBadge?: ReactNode }) {
  const { hasPermission } = useAuth()
  const { t } = useTranslation()

  const visibleItems = NAV_ITEMS.filter((item) => item.permission === null || hasPermission(item.permission))

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">{t('common.appName')}</div>
      <nav className="sidebar-nav">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
          >
            {item.label === 'nav.notifications' && notificationBadge ? (
              <span className="nav-item-with-badge">
                {t(item.label)}
                {notificationBadge}
              </span>
            ) : (
              t(item.label)
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}