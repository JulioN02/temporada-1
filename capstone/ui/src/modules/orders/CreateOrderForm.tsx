import { useRef, useState } from 'react'
import { createOrder } from '../../api/orders.ts'
import { listCustomers } from '../../api/customers.ts'
import { listProducts } from '../../api/products.ts'
import type { CreateOrderInput } from '../../api/types.ts'
import { useResource } from '../../hooks/useResource.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { parseMoney } from '../../i18n/formatters.ts'
import { FormField, Input, Select } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'
import { validateOrderForm } from './validate.ts'

/**
 * Create order form (it4 T-4-6 — R-UI-ORD-3). Dynamic line editor:
 * customer select + N lines (product, qty >= 1, unitPrice D13 scale <= 2).
 * Empty customer / zero lines / per-line errors blocked client-side; a FRESH
 * Idempotency-Key per submit (regenerated after a failed attempt — the old
 * key is consumed). 201 → draft row + toast; replay 200 → success.
 */
export function CreateOrderForm({ onDone }: { onDone: () => void }) {
  const { t, locale } = useTranslation()
  const keyRef = useRef(crypto.randomUUID())

  const customersRes = useResource(() => listCustomers({ limit: 100 }), [])
  const productsRes = useResource(() => listProducts({ limit: 100 }), [])
  const customers = customersRes.data?.data ?? []
  const products = productsRes.data?.data ?? []

  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState([{ productId: '', qty: '', unitPrice: '' }])
  const [errors, setErrors] = useState<{ customer?: string | undefined; lines?: string | undefined; lineErrors: { product?: string | undefined; qty?: string | undefined; unitPrice?: string | undefined }[] }>({
    lineErrors: [],
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function addLine(): void {
    setLines((prev) => [...prev, { productId: '', qty: '', unitPrice: '' }])
  }

  function removeLine(index: number): void {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function updateLine(index: number, patch: Partial<{ productId: string; qty: string; unitPrice: string }>): void {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  async function handleSubmit(): Promise<void> {
    const validation = validateOrderForm({ customerId, lines }, locale, t)
    setErrors(validation)
    if (validation.customer || validation.lines || validation.lineErrors.some((e) => e.product || e.qty || e.unitPrice)) {
      return
    }

    setPending(true)
    setFormError(null)
    const input: CreateOrderInput = {
      customerId,
      lines: lines.map((line) => ({
        productId: line.productId,
        qty: Number(line.qty),
        unitPrice: parseMoney(line.unitPrice, locale) ?? '0.00', // validation guaranteed a value
      })),
    }
    try {
      const { status } = await createOrder(input, keyRef.current)
      void status // 201 created OR 200 replay → success (R-UI-FND-4)
      showToast('success', t('orders.create.success'))
      onDone()
    } catch (err) {
      // R-UI-FND-4: a failed attempt consumes the key — retry with a NEW one
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
      <FormField label={t('orders.create.customer')} htmlFor="order-customer" error={errors.customer}>
        <Select id="order-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">—</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </FormField>

      {errors.lines ? (
        <p className="form-error" role="alert">
          {errors.lines}
        </p>
      ) : null}

      {lines.map((line, index) => {
        const lineError = errors.lineErrors[index]
        return (
          <div key={index} className="order-line" aria-label={`Línea ${index + 1}`}>
            <FormField label={t('orders.create.product')} htmlFor={`line-${index}-product`} error={lineError?.product}>
              <Select id={`line-${index}-product`} value={line.productId} onChange={(e) => updateLine(index, { productId: e.target.value })}>
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('orders.create.qty')} htmlFor={`line-${index}-qty`} error={lineError?.qty}>
              <Input id={`line-${index}-qty`} value={line.qty} onChange={(e) => updateLine(index, { qty: e.target.value })} />
            </FormField>
            <FormField label={t('orders.create.unitPrice')} htmlFor={`line-${index}-price`} error={lineError?.unitPrice}>
              <Input id={`line-${index}-price`} value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} />
            </FormField>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => removeLine(index)}
            >
              {t('orders.create.removeLine')}
            </button>
          </div>
        )
      })}

      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
          {t('orders.create.addLine')}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}