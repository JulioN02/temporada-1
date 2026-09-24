/**
 * R-UI-NOT-3 unread badge bus — module-scoped emitter (same pattern as the
 * ToastProvider emitter, apply-progress #15). The badge subscribes; the
 * NotificationsPage (and future emitters) call `notifyUnreadChanged()` after
 * a successful mark-read so the shell badge refreshes without a full reload.
 */
type UnreadListener = () => void

const listeners = new Set<UnreadListener>()

export function subscribeUnreadChanged(listener: UnreadListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyUnreadChanged(): void {
  for (const listener of listeners) listener()
}