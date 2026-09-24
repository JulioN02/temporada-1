import { useRef, useState } from 'react'
import { adjust } from '../../api/stock.ts'
import type { Product, Warehouse } from '../../api/types.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { FormField, Input, Select } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'
import { validateAdjust } from './forms.ts'

/**
 * Adjust stock form (it4 T-4-3 — R-UI-STK-3). Signed NON-ZERO integer qty +
 * reason >= 10 blocked client-side; a FRESH Idempotency-Key per submit
 * (generated once when the modal opens, reused on retries of the same
 * logical submit — double-click replay → 200, exactly one movement).
 * 409 NEGATIVE_STOCK renders localized with the form intact and the level
 * cell untouched (server rolled back — zero side effects).
 */
export function AdjustForm({
  products,
  warehouses,
  onDone,
}: {
  products: readonly Product[]
  warehouses: readonly Warehouse[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const keyRef = useRef(crypto.randomUUID())
  const [productId, setProductId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ quantity?: string | undefined; reason?: string | undefined }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(): Promise<void> {
    const validation = validateAdjust({ quantity, reason }, t)
    setErrors(validation)
    if (validation.quantity || validation.reason || productId === '' || warehouseId === '') return

    setPending(true)
    setFormError(null)
    try {
      const { status } = await adjust(
        { productId, warehouseId, quantity: Number(quantity), reason: reason.trim() },
        keyRef.current,
      )
      // 201 created OR 200 idempotent replay → success (R-UI-FND-4)
      void status
      showToast('success', t('notifications.type.stockAdjusted'))
      onDone()
    } catch (err) {
      // R-STK-3: a failed attempt CONSUMES the key — the retry must use a
      // NEW key (old key is consumed server-side).
      keyRef.current = crypto.randomUUID()
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
      <FormField label={t('stock.product')} htmlFor="adjust-product">
        <Select id="adjust-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">—</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('stock.warehouse')} htmlFor="adjust-warehouse">
        <Select id="adjust-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">—</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('stock.adjust.quantity')} htmlFor="adjust-quantity" error={errors.quantity}>
        <Input id="adjust-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </FormField>
      <FormField label={t('stock.adjust.reason')} htmlFor="adjust-reason" error={errors.reason}>
        <Input id="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}