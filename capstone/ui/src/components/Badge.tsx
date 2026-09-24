import type { ReactNode } from 'react'

export const BADGE_TONES = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
} as const
export type BadgeTone = (typeof BADGE_TONES)[keyof typeof BADGE_TONES]

/** Small status pill with a tone (state/role/low-stock/active badges). */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}