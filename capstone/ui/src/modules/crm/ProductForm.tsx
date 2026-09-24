import { useState } from 'react'
import { createProduct, updateProduct } from '../../api/products.ts'
import type { Product, UpdateProductInput } from '../../api/types.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { FormField, Input } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'
import { parseThreshold, validateProductInput } from './productForm.ts'

/**
 * Product create/edit form (it3 T-3-5/6 — R-UI-CRM-6/7). Client blocks:
 * empty name, sku not matching `[A-Za-z0-9._-]`, threshold not an integer
 * >= 0 — before any request. 409 DUPLICATE_SKU renders localized with the
 * form data intact. Edit sends ONLY the changed fields.
 */
export function ProductForm({
  mode,
  initial,
  onDone,
}: {
  mode: 'create' | 'edit'
  initial?: Product | undefined
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [threshold, setThreshold] = useState(String(initial?.lowStockThreshold ?? ''))
  const [errors, setErrors] = useState<{ name?: string | undefined; sku?: string | undefined; lowStockThreshold?: string | undefined }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(): Promise<void> {
    const validation = validateProductInput({ name, sku, lowStockThreshold: threshold }, t)
    setErrors(validation)
    if (validation.name || validation.sku || validation.lowStockThreshold) return

    setPending(true)
    setFormError(null)
    try {
      if (mode === 'create') {
        await createProduct({
          name: name.trim(),
          sku: sku.trim(),
          lowStockThreshold: parseThreshold(threshold),
        })
        showToast('success', t('crm.product.created'))
      } else if (initial) {
        const changed: UpdateProductInput = {}
        if (name.trim() !== initial.name) changed.name = name.trim()
        if (sku.trim() !== initial.sku) changed.sku = sku.trim()
        if (parseThreshold(threshold) !== initial.lowStockThreshold) changed.lowStockThreshold = parseThreshold(threshold)
        if (Object.keys(changed).length === 0) {
          onDone()
          return
        }
        await updateProduct(initial.id, changed)
        showToast('success', t('crm.product.updated'))
      }
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
      <FormField label={t('crm.product.name')} htmlFor="product-name" error={errors.name}>
        <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label={t('crm.product.sku')} htmlFor="product-sku" error={errors.sku}>
        <Input id="product-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
      </FormField>
      <FormField label={t('crm.product.lowStockThreshold')} htmlFor="product-threshold" error={errors.lowStockThreshold}>
        <Input id="product-threshold" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}