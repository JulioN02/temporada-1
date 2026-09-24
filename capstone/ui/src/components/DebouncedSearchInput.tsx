import { useEffect, useState } from 'react'
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts'
import { useTranslation } from '../i18n/useTranslation.ts'

/**
 * Debounced search input (R-UI-CRM-1): local state, emits `onSearch` only
 * after `delayMs` of inactivity. The initial mount emits the initial value
 * (page loads with default params).
 */
export function DebouncedSearchInput({
  initialValue = '',
  placeholder,
  delayMs = 300,
  onSearch,
}: {
  initialValue?: string
  placeholder?: string
  delayMs?: number
  onSearch: (query: string) => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialValue)
  const debounced = useDebouncedValue(value, delayMs)

  useEffect(() => {
    onSearch(debounced)
    // onSearch intentionally not in deps — the debounced value drives the search
  }, [debounced])

  return (
    <input
      type="search"
      className="input"
      value={value}
      placeholder={placeholder ?? t('common.search')}
      aria-label={placeholder ?? t('common.search')}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}