import { useState } from 'react'
import { createUser, updateUser } from '../../api/users.ts'
import type { PublicUser, Role } from '../../api/types.ts'
import { ROLES } from '../../api/types.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { FormField, Input, Select } from '../../components/FormField.tsx'
import { showToast } from '../../components/ToastProvider.tsx'
import { roleLabelKey, validateCreateUserInput, validateEmail, validatePassword, validateUsername } from './userForm.ts'

/**
 * User create/invite + edit form (it5 T-5-3/T-5-4 — R-UI-USR-2/3).
 *
 * CREATE: username (3-50 [A-Za-z0-9_]), fullName, email, role (5), password
 * 12-128 with letter+digit + live strength hint. NO locale field (locked
 * delta — new users default 'es' and self-serve later; R-UI-USR-2 asserted).
 * Success → 201 → invitation toast; the password is NEVER echoed (R-AUD-3
 * hygiene). 409 USERNAME_TAKEN → localized, form intact.
 *
 * EDIT: role select only (role change); the active toggle lives on the row
 * (confirm-gated, T-5-4) — PATCH {role} on save.
 */
const ROLE_OPTIONS: readonly Role[] = [ROLES.admin, ROLES.manager, ROLES.operator, ROLES.viewer, ROLES.auditor]

export function UserForm({
  mode,
  initial,
  onDone,
}: {
  mode: 'create' | 'edit'
  initial?: PublicUser | undefined
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [username, setUsername] = useState(initial?.username ?? '')
  const [fullName, setFullName] = useState(initial?.fullName ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [role, setRole] = useState<Role>(initial?.role ?? ROLES.viewer)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{
    username?: string | undefined
    email?: string | undefined
    password?: string | undefined
  }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Live strength hint (R-UI-USR-2): shown while a non-empty password is
  // invalid AND no submit error is displayed (avoids duplicate messages).
  const strengthHint =
    mode === 'create' && password !== '' && !errors.password ? validatePassword(password, t) : null

  async function handleSubmit(): Promise<void> {
    if (mode === 'create') {
      const validation = validateCreateUserInput({ username, fullName, email, role, password }, t)
      setErrors(validation)
      if (validation.username || validation.email || validation.password) return

      setPending(true)
      setFormError(null)
      try {
        await createUser({
          username: username.trim(),
          fullName: fullName.trim() === '' ? undefined : fullName.trim(),
          email: email.trim(),
          role,
          password,
        })
        showToast('success', t('users.invitationSent'))
        onDone()
      } catch (err) {
        setFormError(localizeError(err, t))
      } finally {
        setPending(false)
      }
      return
    }

    // edit: role change only
    if (!initial) return
    setPending(true)
    setFormError(null)
    try {
      await updateUser(initial.id, { role })
      showToast('success', t('users.updated'))
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
      {mode === 'create' ? (
        <>
          <FormField label={t('users.username')} htmlFor="user-username" error={errors.username}>
            <Input id="user-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </FormField>
          <FormField label={t('users.fullName')} htmlFor="user-fullname">
            <Input id="user-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
          <FormField label={t('users.email')} htmlFor="user-email" error={errors.email}>
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label={t('users.password')} htmlFor="user-password" error={errors.password}>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {strengthHint ? (
              <p className="field-hint" role="status">
                {strengthHint}
              </p>
            ) : null}
          </FormField>
        </>
      ) : null}
      <FormField label={t('users.role')} htmlFor="user-role">
        <Select id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(roleLabelKey(option))}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

export { validateEmail, validatePassword, validateUsername }