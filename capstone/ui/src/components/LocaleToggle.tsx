import { useAuth } from '../auth/AuthContext.tsx'
import { patchMe } from '../api/auth.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import type { Locale } from '../i18n/types.ts'

/**
 * ES ⇄ EN locale toggle (R-I18N-3). Pre-auth: localStorage only (LocaleProvider
 * persists it; NO API call). Post-auth: also pushes `PATCH /api/auth/me
 * {locale}` (R-BE-4). The local state is optimistic — on a failed PATCH the
 * next me/refresh re-syncs (backend-wins-on-boot self-heals; the failure is
 * non-critical so it is deliberately silent). The visible "ES"/"EN" glyphs
 * are language codes — technical identifiers, not translatable copy.
 */
const LOCALES: readonly Locale[] = ['es', 'en']

export function LocaleToggle() {
  const { locale, setLocale } = useTranslation()
  const { user } = useAuth()

  function handleToggle(next: Locale): void {
    setLocale(next)
    if (user) {
      void patchMe(next).catch(() => {
        // silent — backend corrects on the next me/refresh
      })
    }
  }

  return (
    <div className="locale-toggle" role="group">
      {LOCALES.map((option) => {
        const active = locale === option
        return (
          <button
            key={option}
            type="button"
            className={active ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
            aria-pressed={active}
            onClick={() => handleToggle(option)}
          >
            {option.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}