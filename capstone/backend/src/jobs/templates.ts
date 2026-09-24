import type { NotificationType } from '../modules/notifications/types.ts'
import { NOTIFICATION_TYPES } from '../modules/notifications/types.ts'
import { LOCALES, type Locale } from '../lib/locales.ts'

/**
 * Notification templates (T-5-5 + capstone-ui it1, R-NOT-5 modified / R-BE-2):
 * PURE functions — payload in, {title, body} out, per locale. Rendered ONCE
 * at emit time in the recipient's stored locale (immutable snapshot stored on
 * the notification row, including the `locale` it was rendered in) and reused
 * by the worker for the email body — the worker never re-renders, so a
 * template change never rewrites history (R-NOT-5).
 *
 * Bilingual dictionaries (R-BE-2): `TEMPLATES[es|en]` expose IDENTICAL key
 * sets for all 7 types (parity asserted by tests/unit/templates.test.ts); ES
 * strings are neutral professional Spanish (no voseo — banned-token scan).
 * Default locale is 'es'; an unknown locale falls back to 'es' (R-NOT-5).
 *
 * Credential hygiene (R-NOT-5): `user_invited` renders the invitee's username
 * ONLY — passwords are never present in any payload rendered here, and the
 * template code has no access to credential material by construction.
 */

export interface RenderedNotification {
  title: string
  body: string
}

type TemplateString = (payload: Record<string, unknown>) => string

interface TypeTemplates {
  title: TemplateString
  body: TemplateString
}

export type TemplateDictionary = Record<NotificationType, TypeTemplates>

const ES: TemplateDictionary = {
  [NOTIFICATION_TYPES.orderConfirmed]: {
    title: () => 'Pedido confirmado',
    body: (p) => `Pedido ${String(p.orderId)} confirmado — total ${String(p.total)}`,
  },
  [NOTIFICATION_TYPES.orderCancelled]: {
    title: () => 'Pedido cancelado',
    body: (p) =>
      `Pedido ${String(p.orderId)} cancelado${p.reason ? ` — ${String(p.reason)}` : ''}`,
  },
  [NOTIFICATION_TYPES.lowStock]: {
    title: () => 'Stock bajo',
    body: (p) =>
      `El producto ${String(p.productName)} (${String(p.sku)}) tiene stock bajo: nivel ${String(p.level)}, umbral ${String(p.threshold)}`,
  },
  [NOTIFICATION_TYPES.stockAdjusted]: {
    title: () => 'Stock ajustado',
    body: (p) =>
      `${String(p.productName)} (${String(p.sku)}) ajustado ${Number(p.sign) > 0 ? 'al alza' : 'a la baja'} en ${String(p.quantity)} — nuevo nivel ${String(p.level)}`,
  },
  [NOTIFICATION_TYPES.stockTransferred]: {
    title: () => 'Stock transferido',
    body: (p) =>
      `${String(p.quantity)} × ${String(p.productName)} (${String(p.sku)}) transferido de ${String(p.fromWarehouse)} a ${String(p.toWarehouse)}`,
  },
  [NOTIFICATION_TYPES.userInvited]: {
    // R-NOT-5: NEVER render passwords/credentials — username only.
    title: () => 'Ha sido invitado',
    body: (p) =>
      `Hola${p.fullName ? ` ${String(p.fullName)}` : ''}, su cuenta "${String(p.username)}" fue creada por un administrador.`,
  },
  [NOTIFICATION_TYPES.jobFailed]: {
    title: () => 'Trabajo en segundo plano fallido',
    body: (p) =>
      `El trabajo ${String(p.jobId)} de la cola ${String(p.queue)} falló tras ${String(p.attempt)} intentos. Puede reintentarlo desde la API de trabajos.`,
  },
}

const EN: TemplateDictionary = {
  [NOTIFICATION_TYPES.orderConfirmed]: {
    title: () => 'Order confirmed',
    body: (p) => `Order ${String(p.orderId)} confirmed — total ${String(p.total)}`,
  },
  [NOTIFICATION_TYPES.orderCancelled]: {
    title: () => 'Order cancelled',
    body: (p) =>
      `Order ${String(p.orderId)} cancelled${p.reason ? ` — ${String(p.reason)}` : ''}`,
  },
  [NOTIFICATION_TYPES.lowStock]: {
    title: () => 'Low stock',
    body: (p) =>
      `Product ${String(p.productName)} (${String(p.sku)}) is low: ${String(p.level)} below threshold ${String(p.threshold)}`,
  },
  [NOTIFICATION_TYPES.stockAdjusted]: {
    title: () => 'Stock adjusted',
    body: (p) =>
      `${String(p.productName)} (${String(p.sku)}) adjusted ${Number(p.sign) > 0 ? 'up' : 'down'} by ${String(p.quantity)} — new level ${String(p.level)}`,
  },
  [NOTIFICATION_TYPES.stockTransferred]: {
    title: () => 'Stock transferred',
    body: (p) =>
      `${String(p.quantity)} × ${String(p.productName)} (${String(p.sku)}) transferred ${String(p.fromWarehouse)} → ${String(p.toWarehouse)}`,
  },
  [NOTIFICATION_TYPES.userInvited]: {
    // R-NOT-5: NEVER render passwords/credentials — username only.
    title: () => 'You have been invited',
    body: (p) =>
      `Hello${p.fullName ? ` ${String(p.fullName)}` : ''}, your account "${String(p.username)}" was created by an administrator.`,
  },
  [NOTIFICATION_TYPES.jobFailed]: {
    title: () => 'Background job failed',
    body: (p) =>
      `Queue ${String(p.queue)} job ${String(p.jobId)} failed after ${String(p.attempt)} attempts. Retry it from the jobs API.`,
  },
}

/** Bilingual dictionaries (R-BE-2) — key parity asserted by the unit tests. */
export const TEMPLATES: Record<Locale, TemplateDictionary> = {
  [LOCALES.es]: ES,
  [LOCALES.en]: EN,
}

/**
 * Public entry: renders the template for a type + payload in the given locale
 * (default 'es'). Unknown locale values fall back to 'es' (R-NOT-5 fallback).
 */
export function renderNotification(
  type: NotificationType,
  payload: Record<string, unknown>,
  locale: string = LOCALES.es,
): RenderedNotification {
  const dict = TEMPLATES[locale as Locale] ?? TEMPLATES.es
  const template = dict[type]
  return { title: template.title(payload), body: template.body(payload) }
}