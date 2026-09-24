import { useState } from 'react'
import { createCustomer, updateCustomer } from '../../api/customers.ts'
import type { Customer, UpdateCustomerInput } from '../../api/types.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { FormField, Input } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'
import { isEmailValid, validateCustomerInput } from './customerForm.ts'

/**
 * Customer create/edit form (it3 T-3-3 — R-UI-CRM-2/3). Client-side
 * validation blocks empty name / malformed email BEFORE submit; server 409
 * DUPLICATE_EMAIL renders localized with the form data intact. Edit mode
 * sends ONLY the changed fields (R-UI-CRM-3 scenario: phone-only edit →
 * PATCH {phone}); a 404 renders the localized customer-not-found message.
 */
export function CustomerForm({
  mode,
  initial,
  onDone,
}: {
  mode: 'create' | 'edit'
  initial?: Customer | undefined
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<{ name?: string | undefined; email?: string | undefined }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(): Promise<void> {
    const validation = validateCustomerInput({ name, email }, t)
    setErrors(validation)
    if (validation.name || validation.email) return

    setPending(true)
    setFormError(null)
    try {
      if (mode === 'create') {
        await createCustomer({
          name: name.trim(),
          email: email.trim() === '' ? undefined : email.trim(),
          phone: phone.trim() === '' ? undefined : phone.trim(),
          notes: notes.trim() === '' ? undefined : notes.trim(),
        })
        showToast('success', t('crm.customer.created'))
      } else if (initial) {
        const changed: UpdateCustomerInput = {}
        if (name.trim() !== initial.name) changed.name = name.trim()
        // email is z.email() server-side: '' is invalid — only send a NON-EMPTY
        // changed email (clearing is not representable via PATCH).
        if (email.trim() !== '' && email.trim() !== (initial.email ?? '')) changed.email = email.trim()
        if (phone.trim() !== (initial.phone ?? '')) changed.phone = phone.trim()
        if (notes.trim() !== (initial.notes ?? '')) changed.notes = notes.trim()
        if (Object.keys(changed).length === 0) {
          onDone()
          return
        }
        await updateCustomer(initial.id, changed)
        showToast('success', t('crm.customer.updated'))
      }
      onDone()
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'NOT_FOUND') {
        setFormError(t('crm.customer.notFound'))
      } else {
        setFormError(localizeError(err, t))
      }
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
      <FormField label={t('crm.customer.name')} htmlFor="customer-name" error={errors.name}>
        <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label={t('crm.customer.email')} htmlFor="customer-email" error={errors.email}>
        <Input id="customer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </FormField>
      <FormField label={t('crm.customer.phone')} htmlFor="customer-phone">
        <Input id="customer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </FormField>
      <FormField label={t('crm.customer.notes')} htmlFor="customer-notes">
        <Input id="customer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

export { isEmailValid }