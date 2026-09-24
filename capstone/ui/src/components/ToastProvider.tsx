import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Toast system (capstone-ui it2b, T-2-8 — R-UI-FND-3: mutation results
 * surface via localized toasts). Module-scoped emitter: `showToast` has a
 * STABLE identity (no context-value churn), so effects that depend on it
 * never re-fire (PermissionRoute denial toasts). The provider renders the
 * stack and auto-dismisses entries after a TTL.
 */
export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

const TOAST_TTL_MS = 4000

let nextToastId = 1
let emitToast: ((item: ToastItem) => void) | null = null

/** Stable push — safe to call from effects and event handlers. */
export function showToast(type: ToastType, message: string): void {
  emitToast?.({ id: nextToastId++, type, message })
}

export function useToast(): { showToast: typeof showToast } {
  return { showToast }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    emitToast = (item) => {
      setToasts((prev) => [...prev, item])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((existing) => existing.id !== item.id))
      }, TOAST_TTL_MS)
    }
    return () => {
      emitToast = null
    }
  }, [])

  return (
    <>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.type}`}>
            {item.message}
          </div>
        ))}
      </div>
    </>
  )
}