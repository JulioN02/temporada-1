import { useTranslation } from '../i18n/useTranslation.ts'
import type { MessageKey } from '../i18n/types.ts'

/**
 * Iteration placeholder for module pages (it3+ builds real pages on top of
 * the shell). Renders the localized module title using an existing pinned
 * catalog key — no new copy, no S3-gate violation.
 */
export function PlaceholderPage({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useTranslation()
  return (
    <section className="page">
      <h1>{t(titleKey)}</h1>
    </section>
  )
}