/**
 * T-2-4 (capstone-ui it2a) — i18n infrastructure tests (R-I18N-1..4).
 * RED: references LocaleProvider / useLocale / localizeError / translate and
 * the locale dictionaries — none exist yet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { es } from '../src/i18n/locales/es.ts'
import { en } from '../src/i18n/locales/en.ts'
import { translate, useTranslation } from '../src/i18n/useTranslation.ts'
import { LocaleProvider, LOCALE_STORAGE_KEY, useLocale } from '../src/i18n/LocaleContext.tsx'
import { localizeError } from '../src/i18n/localizeError.ts'

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

/* ── R-I18N-1: key parity ─────────────────────────────────────────────── */

describe('R-I18N-1: dictionary key parity es ≡ en', () => {
  it('R-I18N-1: es exposes exactly the same keys as en (both directions)', () => {
    const esKeys = Object.keys(es).sort()
    const enKeys = Object.keys(en).sort()
    expect(esKeys).toEqual(enKeys)
    expect(enKeys).toEqual(esKeys)
    expect(esKeys.length).toBeGreaterThan(50)
  })

  it('R-I18N-1: every value is a non-empty string in both locales', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(typeof value).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
      expect((en as Record<string, string>)[key]).toBeTruthy()
    }
  })
})

/* ── R-I18N-2: neutral Spanish gate ───────────────────────────────────── */

describe('R-I18N-2: banned-token scan over UI dictionaries', () => {
  it('R-I18N-2: zero banned voseo/Rioplatense tokens in the ES dictionary', () => {
    const banned = ['vos', 'tenés', 'querés', 'sos', 'andá', 'che', 'dale']
    const offenders: string[] = []
    for (const value of Object.values(es)) {
      for (const token of banned) {
        if (new RegExp(`\\b${token}\\b`, 'i').test(value)) {
          offenders.push(`${token} -> "${value}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/* ── R-I18N-4: localizeError ──────────────────────────────────────────── */

describe('R-I18N-4: localized API error mapping', () => {
  const tEs = (key: Parameters<typeof translate>[1]) => translate(es, key)
  const tEn = (key: Parameters<typeof translate>[1]) => translate(en, key)

  it('R-I18N-4: INSUFFICIENT_STOCK maps to the neutral Spanish stock message', () => {
    const message = localizeError({ status: 409, code: 'INSUFFICIENT_STOCK', message: 'raw' }, tEs)
    expect(message).toBe('Stock insuficiente para completar la operación')
    expect(message).not.toContain('raw')
  })

  it('R-I18N-4: WAREHOUSE_IN_USE maps to a specific localized string', () => {
    expect(localizeError({ status: 409, code: 'WAREHOUSE_IN_USE', message: 'raw' }, tEs)).toBe(
      'El almacén está en uso y no se puede eliminar',
    )
  })

  it('R-I18N-4: UNAUTHORIZED maps to the session-expired message', () => {
    expect(localizeError({ status: 401, code: 'UNAUTHORIZED', message: 'raw' }, tEs)).toBe(
      'Sesión expirada, inicia sesión de nuevo',
    )
  })

  it('R-I18N-4: unknown code falls back to the generic localized message (never raw)', () => {
    expect(localizeError({ status: 500, code: 'SURPRISE', message: 'raw server text' }, tEs)).toBe(
      'Ocurrió un error inesperado',
    )
  })

  it('R-I18N-4: bare CONFLICT (warehouse duplicate-name subcode) maps to the generic conflict message', () => {
    expect(localizeError({ status: 409, code: 'CONFLICT', message: 'raw' }, tEs)).toBe(
      'La operación entró en conflicto con los datos actuales',
    )
  })

  it('R-I18N-4: non-error values and INTERNAL_ERROR also fall back to the generic message', () => {
    expect(localizeError(null, tEs)).toBe('Ocurrió un error inesperado')
    expect(localizeError(new TypeError('boom'), tEs)).toBe('Ocurrió un error inesperado')
    expect(localizeError({ status: 500, code: 'INTERNAL_ERROR', message: 'raw' }, tEs)).toBe(
      'Error interno del servidor, intenta de nuevo',
    )
  })

  it('R-I18N-4: the same code set is mapped in both locales (parity)', () => {
    const esResult = localizeError({ status: 403, code: 'FORBIDDEN', message: 'raw' }, tEs)
    const enResult = localizeError({ status: 403, code: 'FORBIDDEN', message: 'raw' }, tEn)
    expect(esResult).not.toBe('raw')
    expect(enResult).not.toBe('raw')
    expect(esResult).toBe('No tienes permiso para esta acción')
    expect(enResult).toBe('You do not have permission for this action')
  })
})

/* ── R-I18N-3: provider behavior (toggle component tests land at it2b) ─ */

function LocaleProbe() {
  const { locale, setLocale } = useLocale()
  const { t } = useTranslation()
  return (
    <div>
      <span>locale:{locale}</span>
      <button onClick={() => setLocale('en')}>{t('common.save')}</button>
    </div>
  )
}

describe('R-I18N-3: LocaleProvider — default, persistence, lang sync (pre-auth)', () => {
  it('R-I18N-3: fresh visitor (no stored locale) boots in es and syncs document.lang', () => {
    render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    )
    expect(screen.getByText('locale:es')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('es')
  })

  it('R-I18N-3: toggling persists to localStorage and re-renders the whole tree without reload', async () => {
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByText('locale:en')).toBeInTheDocument()
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('R-I18N-3: stored locale wins on boot; garbage falls back to es', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const { unmount } = render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    )
    expect(screen.getByText('locale:en')).toBeInTheDocument()
    unmount()

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr')
    render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    )
    expect(screen.getByText('locale:es')).toBeInTheDocument()
  })

  it('R-I18N-3: pre-auth toggle fires NO API call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})