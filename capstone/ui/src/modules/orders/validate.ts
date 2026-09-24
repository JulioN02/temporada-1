import type { Locale, TFunction } from '../../i18n/types.ts'
import { parseMoney } from '../../i18n/formatters.ts'

/**
 * Order form validation (it4 T-4-6 — R-UI-ORD-3). Pure functions with the
 * translator injected: customer required, ≥ 1 line, per-line product
 * selected, qty integer ≥ 1, unitPrice D13 scale ≤ 2 (parseMoney).
 * Client-side blocks fire NO request.
 */
export interface OrderLineFormInput {
  productId: string
  qty: string
  unitPrice: string
}

export function validateOrderLine(
  line: OrderLineFormInput,
  locale: Locale,
  t: TFunction,
): { product?: string | undefined; qty?: string | undefined; unitPrice?: string | undefined } {
  const errors: { product?: string | undefined; qty?: string | undefined; unitPrice?: string | undefined } = {}
  if (line.productId === '') {
    errors.product = t('orders.create.productRequired')
  }
  const qty = line.qty.trim()
  if (qty === '' || !/^\d+$/.test(qty) || Number(qty) < 1) {
    errors.qty = t('orders.create.qtyMin')
  }
  if (parseMoney(line.unitPrice, locale) === null) {
    errors.unitPrice = t('orders.create.priceScale')
  }
  return errors
}

export function validateOrderForm(
  input: { customerId: string; lines: OrderLineFormInput[] },
  locale: Locale,
  t: TFunction,
): { customer?: string | undefined; lines?: string | undefined; lineErrors: ReturnType<typeof validateOrderLine>[] } {
  const errors: { customer?: string | undefined; lines?: string | undefined } = {}
  if (input.customerId === '') {
    errors.customer = t('orders.create.customerRequired')
  }
  if (input.lines.length === 0) {
    errors.lines = t('orders.create.atLeastOneLine')
  }
  const lineErrors = input.lines.map((line) => validateOrderLine(line, locale, t))
  return { ...errors, lineErrors }
}