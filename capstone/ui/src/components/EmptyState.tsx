import { useTranslation } from '../i18n/useTranslation.ts'

/** Empty state (R-UI-FND-3): localized "No records" placeholder. */
export function EmptyState({ message }: { message?: string | undefined }) {
  const { t } = useTranslation()
  return <div className="empty-state">{message ?? t('common.noRecords')}</div>
}