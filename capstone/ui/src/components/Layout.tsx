import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.tsx'
import { useTranslation } from '../i18n/useTranslation.ts'
import { LocaleToggle } from './LocaleToggle.tsx'
import { Sidebar } from './Sidebar.tsx'
import { NotificationBadge } from '../modules/governance/NotificationBadge.tsx'

/**
 * Shell layout (R-UI-FND-2): persistent sidebar (role-aware nav), header with
 * locale toggle + user chip (name + role + locale) + logout for every role.
 * Logout clears memory state; ProtectedRoute then redirects to /login
 * (R-AUTHUI-3) — no imperative navigation needed here.
 * The sidebar unread-badge slot (T-2-8) is wired to NotificationBadge
 * (R-UI-NOT-3 — unread count via limit=1 pagination.total, refreshed on
 * mark-read via the unread bus and on navigation).
 *
 * R-RBAC-4 (it6): every ROUTE CHANGE re-fetches `GET /api/auth/me`
 * (design ADR-6) — an admin's mid-session role demotion/promotion re-renders
 * the sidebar + action visibility on the next navigation without re-login.
 * The effect is keyed on pathname ONLY (first render skipped): the closure
 * captures the current render's `refreshUser`, so no refresh-identity loop is
 * possible, and a failed me() stays silent (AuthContext contract).
 */
export function Layout() {
  const { user, logout, refreshUser } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    void refreshUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname-only by design (see docblock)
  }, [location.pathname])

  return (
    <div className="layout">
      <Sidebar notificationBadge={<NotificationBadge />} />
      <div className="layout-main">
        <header className="topbar">
          <LocaleToggle />
          {user ? (
            <div className="user-chip">
              <span className="user-chip-name">{user.fullName ?? user.username}</span>
              <span className="user-chip-role">{user.role}</span>
              <span className="user-chip-locale">{user.locale}</span>
            </div>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}