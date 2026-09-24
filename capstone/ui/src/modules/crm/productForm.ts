import type { TFunction } from '../../i18n/types.ts'

/**
 * Product form validation (it3 T-3-5 — R-UI-CRM-6). Pure function with the
 * translator injected: name required, sku matches `[A-Za-z0-9._-]`,
 * lowStockThreshold is an integer >= 0 (empty → default 0, mirroring the
 * backend default). Client-side blocks fire NO request.
 */
export interface ProductFormInput {
  name: string
  sku: string
  lowStockThreshold: string
}

export const SKU_REGEX = /^[A-Za-z0-9._-]+$/

export function validateProductInput(
  input: ProductFormInput,
  t: TFunction,
): { name?: string | undefined; sku?: string | undefined; lowStockThreshold?: string | undefined } {
  const errors: { name?: string | undefined; sku?: string | undefined; lowStockThreshold?: string | undefined } = {}
  if (input.name.trim() === '') {
    errors.name = t('crm.product.nameRequired')
  }
  const sku = input.sku.trim()
  if (sku === '' || !SKU_REGEX.test(sku)) {
    errors.sku = t('crm.product.skuInvalid')
  }
  const threshold = input.lowStockThreshold.trim()
  if (threshold !== '' && !/^\d+$/.test(threshold)) {
    errors.lowStockThreshold = t('crm.product.thresholdInvalid')
  }
  return errors
}

/** Empty → 0 (backend default); otherwise the parsed integer. */
export function parseThreshold(input: string): number {
  const trimmed = input.trim()
  return trimmed === '' ? 0 : Number(trimmed)
}