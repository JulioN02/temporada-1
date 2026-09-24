import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Transporter } from 'nodemailer'
import { createTransporterMailer } from '../../src/jobs/mailer.ts'

/**
 * Mailer unit tests (T-5-3): the `Mailer` interface + nodemailer implementation
 * — worker-only SMTP client (R-NOT-3). Transport is injectable so tests spy on
 * it without any real SMTP. Errors surfaced by the mailer must NEVER contain
 * SMTP credentials (code-auditor: no credential exposure in errors).
 */

function fakeTransport(behavior: {
  onSend?: (mail: { to: string; subject: string; text: string }) => void
  failWith?: Error
}): Transporter {
  return {
    sendMail: async (mail: { to: string; subject: string; text: string }) => {
      if (behavior.failWith) throw behavior.failWith
      behavior.onSend?.(mail)
      return { messageId: 'fake-1', accepted: [mail.to], rejected: [], pending: [] }
    },
  } as unknown as Transporter
}

describe('jobs/mailer (T-5-3, R-NOT-3)', () => {
  it('R-NOT-3: sendMail delegates to the transport with to/subject/text and resolves on delivery', async () => {
    let sent: { to: string; subject: string; text: string } | null = null
    const mailer = createTransporterMailer(
      fakeTransport({ onSend: (mail) => { sent = mail } }),
    )
    await mailer.sendMail({ to: 'a@test.local', subject: 'Order confirmed', text: 'body' })
    assert.deepEqual(sent, { to: 'a@test.local', subject: 'Order confirmed', text: 'body' })
  })

  it('R-NOT-3: SMTP failure is surfaced as an error WITHOUT the SMTP password value', async () => {
    const mailer = createTransporterMailer(
      fakeTransport({
        failWith: new Error('535 Authentication failed for user=mailer@test.local pass=smtpsecret99'),
      }),
      'smtpsecret99', // the SMTP password the real mailer would scrub
    )
    await assert.rejects(
      mailer.sendMail({ to: 'a@test.local', subject: 'x', text: 'y' }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        assert.ok(message.length > 0, 'a real error is surfaced')
        assert.ok(!message.includes('smtpsecret99'), 'password value must never leak into errors')
        return true
      },
    )
  })
})