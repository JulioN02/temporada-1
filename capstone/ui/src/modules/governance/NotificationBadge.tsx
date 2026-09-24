import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { listNotifications } from '../../api/notifications.ts'
import { useResource } from '../../hooks/useResource.ts'
import { Badge } from '../../components/Badge.tsx'
import { subscribeUnreadChanged } from './unreadBus.ts'

/**
 * Sidebar unread-notification badge (it5 T-5-1 — R-UI-NOT-3): the count is
 * `pagination.total` of `GET /api/notifications?unreadOnly=true&limit=1`
 * (spec-mandated contract). Refreshes on mark-read (bus) AND on navigation
 * (location dep); hidden at zero and on error (never breaks the shell).
 */
export function NotificationBadge() {
  const location = useLocation()
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeUnreadChanged(() => setTick((current) => current + 1)), [])

  const { data } = useResource(
    () => listNotifications({ unreadOnly: true, limit: 1 }).then((result) => result.pagination.total),
    [location.pathname, tick],
  )

  if (data === null || data === 0) return null
  return <Badge tone="danger">{data}</Badge>
}