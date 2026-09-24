import { useTranslation } from '../i18n/useTranslation.ts'

/**
 * Error state (R-UI-FND-3): localized message + retry button that re-fetches.
 * 401s never land here — the refresh flow owns the session-expired UX.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string | null | undefined
  onRetry?: (() => void) | null | undefined
}) {
  const { t } = useTranslation()
  return (
    <div className="error-state" role="alert">
      <p>{message ?? t('common.errorRetry')}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}