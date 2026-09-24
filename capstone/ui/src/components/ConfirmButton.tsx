import { useState } from 'react'
import { useTranslation } from '../i18n/useTranslation.ts'

/**
 * Two-step atomic confirm gate (R-UI-CRM-4, R-UI-ORD-4): first click arms
 * ("Confirmar"/cancel); cancel fires NOTHING; the confirm click runs
 * `onConfirm` exactly once. Used for destructive/mutating actions.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
}: {
  label: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [arming, setArming] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleConfirm(): Promise<void> {
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
      setArming(false)
    }
  }

  if (arming) {
    return (
      <span className="confirm-gate">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={pending || disabled}
          onClick={() => void handleConfirm()}
        >
          {pending ? t('common.loading') : (confirmLabel ?? t('common.confirm'))}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setArming(false)}>
          {t('common.cancel')}
        </button>
      </span>
    )
  }

  return (
    <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setArming(true)}>
      {label}
    </button>
  )
}