import { useActionState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.tsx'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { ApiClientError } from '../api/client.ts'
import { FormField, Input } from '../components/FormField.tsx'
import { LoadingState } from '../components/LoadingState.tsx'
import { LocaleToggle } from '../components/LocaleToggle.tsx'

interface LoginFormState {
  error: string | null
}

/**
 * Login page (R-UI-FND-1): username + password → `POST /api/auth/login`.
 * On 401 a SINGLE localized message renders — identical for unknown-user and
 * wrong-password (no enumeration, mirrors backend R-AUTH-2). Success stores
 * the token in memory and routes to `?next=` (R-AUTHUI-4) or /dashboard.
 * LocaleToggle works pre-auth (R-I18N-3). React 19: useActionState form.
 */
export function LoginPage() {
  const { user, initializing, login } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') ?? '/dashboard'

  const [state, formAction, pending] = useActionState(
    async (_previous: LoginFormState, formData: FormData): Promise<LoginFormState> => {
      const username = String(formData.get('username') ?? '')
      const password = String(formData.get('password') ?? '')
      try {
        await login(username, password)
        navigate(next, { replace: true })
        return { error: null }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          return { error: t('auth.login.invalidCredentials') }
        }
        return { error: localizeError(err, t) }
      }
    },
    { error: null },
  )

  if (initializing) {
    return <LoadingState />
  }

  if (user) {
    return <Navigate to={next} replace />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>{t('auth.login.title')}</h1>
          <LocaleToggle />
        </div>
        <form action={formAction} className="login-form">
          <FormField label={t('auth.login.username')} htmlFor="login-username">
            <Input id="login-username" name="username" required autoComplete="username" />
          </FormField>
          <FormField label={t('auth.login.password')} htmlFor="login-password">
            <Input id="login-password" name="password" type="password" required autoComplete="current-password" />
          </FormField>
          {state.error ? (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
            {pending ? t('common.loading') : t('auth.login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}