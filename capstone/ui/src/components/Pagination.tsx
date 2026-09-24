import { useTranslation } from '../i18n/useTranslation.ts'

/** Localized prev/next pagination controls (R-UI-CRM-1, R-UI-FND-3). */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled = false,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <nav className="pagination" aria-label="pagination">
      <button
        type="button"
        className="btn btn-sm"
        disabled={page <= 1 || disabled}
        onClick={() => onPageChange(page - 1)}
      >
        {t('common.prev')}
      </button>
      <span className="pagination-info">{t('common.pageOf', { page, totalPages })}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={page >= totalPages || disabled}
        onClick={() => onPageChange(page + 1)}
      >
        {t('common.next')}
      </button>
    </nav>
  )
}