import { useTranslation } from '../i18n/useTranslation.ts'
import { formatMoney } from '../i18n/formatters.ts'
import type { D13 } from '../api/types.ts'

/** D13 money display in the active locale (float-free — R-UI-ORD-6). */
export function MoneyText({ value }: { value: D13 }) {
  const { locale } = useTranslation()
  return <span>{formatMoney(value, locale)}</span>
}