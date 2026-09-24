import { useState } from 'react'
import { cancelOrder } from '../../api/orders.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { FormField, Input } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'

/**
 * Cancel order modal (it4 T-4-8 — R-UI-ORD-5). Reason >= 10 chars blocked
 * client-side; success → cancelled + toast, stock NEVER touched (no
 * reversal — R-ORD-6). 409 INVALID_STATE → localized + the parent refreshes
 * from the server.
 */
export function CancelOrderModal({
  orderId,
  onDone,
}: {
  orderId: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(): Promise<void> {
    if (reason.trim().length < 10) {
      setError(t('orders.cancel.reasonMin'))
      return
    }
    setError(null)
    setPending(true)
    setFormError(null)
    try {
      await cancelOrder(orderId, reason.trim())
      showToast('success', t('notifications.type.orderCancelled'))
      onDone()
    } catch (err) {
      setFormError(localizeError(err, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="form-stack">
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <FormField label={t('orders.cancel.reason')} htmlFor="cancel-reason" error={error}>
        <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}