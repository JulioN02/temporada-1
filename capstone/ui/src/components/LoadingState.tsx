import { useTranslation } from '../i18n/useTranslation.ts'

/** Loading state (R-UI-FND-3): localized spinner/skeleton placeholder. */
export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div className="loading-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  )
}