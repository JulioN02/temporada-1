import { useRef, useState } from 'react'
import { transfer } from '../../api/stock.ts'
import type { Product, Warehouse } from '../../api/types.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { FormField, Input, Select } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'
import { validateTransfer } from './forms.ts'

/**
 * Transfer form (it4 T-4-4 — R-UI-STK-4). from ≠ to blocked CLIENT-side
 * ("Las bodegas deben ser diferentes"), qty >= 1, reason >= 10; fresh
 * Idempotency-Key per submit. 409 (backend NEGATIVE_STOCK — see report)
 * renders localized and leaves BOTH level cells unchanged (server
 * all-or-nothing). Success → 2 ledger rows (transfer_out + transfer_in).
 */
export function TransferForm({
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
  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ warehouses?: string | undefined; quantity?: string | undefined; reason?: string | undefined }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(): Promise<void> {
    const validation = validateTransfer({ fromWarehouseId, toWarehouseId, quantity, reason }, t)
    setErrors(validation)
    if (
      validation.warehouses ||
      validation.quantity ||
      validation.reason ||
      productId === '' ||
      fromWarehouseId === '' ||
      toWarehouseId === ''
    ) {
      return
    }

    setPending(true)
    setFormError(null)
    try {
      await transfer(
        { productId, fromWarehouseId, toWarehouseId, quantity: Number(quantity), reason: reason.trim() },
        keyRef.current,
      )
      showToast('success', t('notifications.type.stockTransferred'))
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
      <FormField label={t('stock.product')} htmlFor="transfer-product">
        <Select id="transfer-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">—</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('stock.transfer.from')} htmlFor="transfer-from" error={errors.warehouses}>
        <Select id="transfer-from" value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
          <option value="">—</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('stock.transfer.to')} htmlFor="transfer-to" error={errors.warehouses}>
        <Select id="transfer-to" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
          <option value="">—</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('stock.adjust.quantity')} htmlFor="transfer-quantity" error={errors.quantity}>
        <Input id="transfer-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </FormField>
      <FormField label={t('stock.adjust.reason')} htmlFor="transfer-reason" error={errors.reason}>
        <Input id="transfer-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}