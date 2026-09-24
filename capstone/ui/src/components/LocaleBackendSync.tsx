import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import { useLocale } from '../i18n/LocaleContext.tsx'

/**
 * Backend-wins-on-boot locale sync (R-I18N-3, design ADR-2): the restored
 * user's locale (login/refresh/me payload) overrides the pre-auth
 * localStorage value; LocaleProvider's effect corrects the stored copy and
 * document.lang. Rendered once at the app root, inside both providers.
 */
export function LocaleBackendSync() {
  const { user } = useAuth()
  const { setLocale } = useLocale()
  const locale = user?.locale ?? null

  useEffect(() => {
    if (locale) setLocale(locale)
  }, [locale])

  return null
}