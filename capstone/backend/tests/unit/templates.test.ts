import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NOTIFICATION_TARGETS,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '../../src/modules/notifications/types.ts'
import { renderNotification, TEMPLATES } from '../../src/jobs/templates.ts'
import { LOCALES } from '../../src/lib/locales.ts'

/**
 * T-5-5 registry parity + template tests. R-NOT-2: the channel matrix is
 * LOCKED (spec §6.1 / R-NOT-2 list) — the const registry must match it
 * EXACTLY, and the 005 SQL CHECK constraint must accept exactly those types.
 * R-NOT-5 (delta): templates render title/body per type in BOTH locales;
 * `user_invited` NEVER includes the password (or any credential) in either
 * locale. R-BE-2 (capstone-ui it1): es/en dictionaries with IDENTICAL key
 * sets for all 7 types + neutral-Spanish banned-token scan on every ES
 * string. Default locale is 'es' (R-NOT-5 modified).
 */

/** The locked matrix from the spec (R-NOT-2) — independent literal. */
const LOCKED_MATRIX: Record<string, readonly string[]> = {
  order_confirmed: ['in_app', 'email'],
  order_cancelled: ['in_app', 'email'],
  low_stock: ['in_app', 'email'],
  stock_adjusted: ['in_app'],
  stock_transferred: ['in_app'],
  user_invited: ['email'],
  job_failed: ['in_app'],
}

const LOCKED_TYPES = [
  'order_confirmed',
  'order_cancelled',
  'low_stock',
  'stock_adjusted',
  'stock_transferred',
  'user_invited',
  'job_failed',
]

/** R-I18N-2 / R-BE-2: banned voseo/Rioplatense tokens — neutral Spanish only. */
const BANNED_TOKENS = ['vos', 'tenés', 'querés', 'sos', 'andá', 'che', 'dale']
const BANNED_REGEX = new RegExp(`\\b(${BANNED_TOKENS.join('|')})\\b`, 'i')

/** Sample payload per type — exercises every interpolation branch. */
const SAMPLE_PAYLOAD: Record<NotificationType, Record<string, unknown>> = {
  [NOTIFICATION_TYPES.orderConfirmed]: { orderId: '42', total: '12.50' },
  [NOTIFICATION_TYPES.orderCancelled]: { orderId: '7', reason: 'customer request' },
  [NOTIFICATION_TYPES.lowStock]: { productName: 'Widget', sku: 'W-1', level: '3', threshold: 5 },
  [NOTIFICATION_TYPES.stockAdjusted]: { productName: 'Widget', sku: 'W-1', sign: -1, quantity: 2, level: '1' },
  [NOTIFICATION_TYPES.stockTransferred]: {
    quantity: 3,
    productName: 'Widget',
    sku: 'W-1',
    fromWarehouse: 'A',
    toWarehouse: 'B',
  },
  [NOTIFICATION_TYPES.userInvited]: { username: 'newuser', fullName: 'New User' },
  [NOTIFICATION_TYPES.jobFailed]: { queue: 'notification.send', jobId: 'job-1', attempt: 6 },
}

describe('notifications registry (T-5-5, R-NOT-2)', () => {
  it('R-NOT-2: NOTIFICATION_TARGETS matrix matches the locked channel matrix exactly', () => {
    const registryKeys = Object.keys(NOTIFICATION_TARGETS).sort()
    assert.deepEqual(registryKeys, [...LOCKED_TYPES].sort(), 'all 7 types present, no extras')
    for (const type of LOCKED_TYPES) {
      const target = NOTIFICATION_TARGETS[type as keyof typeof NOTIFICATION_TARGETS]
      assert.ok(target, `target exists for ${type}`)
      assert.deepEqual(
        [...target.channels].sort(),
        [...LOCKED_MATRIX[type]!].sort(),
        `channels for ${type} match the locked matrix`,
      )
    }
  })

  it('R-NOT-2: NOTIFICATION_TYPES const mirrors the 005 CHECK constraint (7 types, DB contract)', () => {
    const sql = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/db/sql/005_notifications.sql'),
      'utf8',
    )
    const types = Object.values(NOTIFICATION_TYPES)
    assert.equal(types.length, 7)
    for (const type of types) {
      assert.ok(sql.includes(`'${type}'`), `005 CHECK includes ${type}`)
    }
    // The CHECK must not silently accept extra types beyond the registry.
    const checkBody = sql.match(/CHECK \(type IN \(([^)]+)\)\)/)
    assert.ok(checkBody, 'type CHECK constraint found')
    const declared = [...checkBody![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort()
    assert.deepEqual(declared, [...types].sort(), 'SQL CHECK ≡ registry types')
  })

  it('R-NOT-2: ADR-4 recipient targeting — explicit-recipient types and role-based types', () => {
    assert.deepEqual(NOTIFICATION_TARGETS.order_confirmed.recipients, { kind: 'creator' })
    assert.deepEqual(NOTIFICATION_TARGETS.order_cancelled.recipients, { kind: 'creator' })
    assert.deepEqual(NOTIFICATION_TARGETS.user_invited.recipients, { kind: 'invitee' })
    assert.deepEqual(NOTIFICATION_TARGETS.low_stock.recipients, {
      kind: 'roles',
      roles: ['manager', 'operator'],
    })
    assert.deepEqual(NOTIFICATION_TARGETS.stock_adjusted.recipients, {
      kind: 'roles',
      roles: ['admin', 'manager'],
    })
    assert.deepEqual(NOTIFICATION_TARGETS.stock_transferred.recipients, {
      kind: 'roles',
      roles: ['admin', 'manager'],
    })
    assert.deepEqual(NOTIFICATION_TARGETS.job_failed.recipients, {
      kind: 'roles',
      roles: ['admin', 'manager'],
    })
  })
})

describe('notification templates bilingual (T-1-2, R-NOT-5 + R-BE-2)', () => {
  it('R-BE-2: es and en dictionaries expose IDENTICAL key sets for all 7 types (both directions)', () => {
    const esKeys = Object.keys(TEMPLATES.es).sort()
    const enKeys = Object.keys(TEMPLATES.en).sort()
    assert.deepEqual(esKeys, enKeys, 'same type keys in both locales')
    assert.deepEqual(enKeys, esKeys, 'same type keys in both locales (reverse direction)')
    assert.deepEqual(esKeys, [...LOCKED_TYPES].sort(), 'exactly the 7 locked types, no extras')
    for (const type of LOCKED_TYPES) {
      const esInner = Object.keys(TEMPLATES.es[type as NotificationType]).sort()
      const enInner = Object.keys(TEMPLATES.en[type as NotificationType]).sort()
      assert.deepEqual(esInner, enInner, `inner keys (title/body) match for ${type}`)
      assert.deepEqual(esInner, ['body', 'title'], `${type} exposes exactly title + body`)
    }
  })

  it('R-BE-2: neutral Spanish — zero banned tokens across every ES template string', () => {
    for (const type of LOCKED_TYPES) {
      const rendered = renderNotification(type as NotificationType, SAMPLE_PAYLOAD[type as NotificationType], LOCALES.es)
      const text = `${rendered.title} ${rendered.body}`
      assert.ok(
        !BANNED_REGEX.test(text),
        `ES template for ${type} contains a banned voseo token: "${text}"`,
      )
    }
  })

  it('R-BE-2: render selects the dictionary by locale — en renders English, es neutral Spanish', () => {
    const es = renderNotification(NOTIFICATION_TYPES.orderConfirmed, { orderId: '42', total: '12.50' }, LOCALES.es)
    assert.equal(es.title, 'Pedido confirmado')
    assert.ok(es.body.includes('42'), 'ES body carries the order id')
    assert.ok(es.body.includes('12.50'), 'ES body carries the exact total')

    const en = renderNotification(NOTIFICATION_TYPES.orderConfirmed, { orderId: '42', total: '12.50' }, LOCALES.en)
    assert.equal(en.title, 'Order confirmed')
    assert.ok(en.body.includes('42'))
    assert.ok(en.body.includes('12.50'))
  })

  it('R-NOT-5 (modified): default locale is es when no locale is passed', () => {
    const rendered = renderNotification(NOTIFICATION_TYPES.orderConfirmed, { orderId: '42', total: '12.50' })
    assert.equal(rendered.title, 'Pedido confirmado', 'default locale must be es')
  })

  it('R-NOT-5 (modified): invalid/unknown locale falls back to es', () => {
    const rendered = renderNotification(NOTIFICATION_TYPES.orderConfirmed, { orderId: '42', total: '12.50' }, 'fr')
    assert.equal(rendered.title, 'Pedido confirmado', 'unknown locale must fall back to es')
  })

  it('R-NOT-5: order_confirmed renders title/body with orderId and total from the payload (en)', () => {
    const rendered = renderNotification(NOTIFICATION_TYPES.orderConfirmed, {
      orderId: '42',
      total: '12.50',
    }, LOCALES.en)
    assert.equal(rendered.title, 'Order confirmed')
    assert.ok(rendered.body.includes('42'), 'body carries the order id')
    assert.ok(rendered.body.includes('12.50'), 'body carries the exact total')
  })

  it('R-NOT-5: order_cancelled renders with reason when present', () => {
    const rendered = renderNotification(NOTIFICATION_TYPES.orderCancelled, {
      orderId: '7',
      reason: 'customer request',
    }, LOCALES.en)
    assert.equal(rendered.title, 'Order cancelled')
    assert.ok(rendered.body.includes('customer request'))
  })

  it('R-NOT-5: low_stock renders product + level + threshold (no secrets)', () => {
    const rendered = renderNotification(NOTIFICATION_TYPES.lowStock, {
      productName: 'Widget',
      sku: 'W-1',
      level: '3',
      threshold: 5,
    }, LOCALES.en)
    assert.equal(rendered.title, 'Low stock')
    assert.ok(rendered.body.includes('Widget'))
    assert.ok(rendered.body.includes('W-1'))
    assert.ok(rendered.body.includes('3'))
  })

  it('R-NOT-5: user_invited NEVER includes the password or any credential material — BOTH locales', () => {
    const payload = { username: 'newuser', fullName: 'New User', password: 'SuperSecret123!' }
    for (const locale of [LOCALES.es, LOCALES.en]) {
      const rendered = renderNotification(NOTIFICATION_TYPES.userInvited, payload, locale)
      assert.ok(rendered.body.includes('newuser'), `${locale}: body carries the username`)
      assert.ok(!rendered.body.includes('SuperSecret123!'), `${locale}: password value must never be rendered`)
      assert.ok(!/pass/i.test(rendered.body), `${locale}: body does not even mention a password`)
    }
  })

  it('R-NOT-5: job_failed renders queue + job id without internal details', () => {
    const rendered = renderNotification(NOTIFICATION_TYPES.jobFailed, {
      queue: 'notification.send',
      jobId: 'job-1',
      attempt: 6,
    }, LOCALES.en)
    assert.equal(rendered.title, 'Background job failed')
    assert.ok(rendered.body.includes('notification.send'))
    assert.ok(rendered.body.includes('job-1'))
  })
})