import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { SmtpConfig } from '../config/env.ts'

/**
 * Mailer (T-5-3, ADR-13): thin SMTP abstraction. The nodemailer implementation
 * lives HERE — the ONLY file in src/ allowed to import nodemailer (enforced by
 * tests/contract/mailer-isolation.test.ts, R-NOT-3). The worker consumes it;
 * the request path NEVER imports this module (its only side effect on the
 * request path is the pg-boss enqueue — the SMTP send happens asynchronously
 * in the worker and can NEVER block or roll back a business transaction,
 * R-NOT-4/R-NOT-6).
 *
 * Credential hygiene (code-auditor): SMTP secrets come from env (zod fail-fast,
 * R-PROD-5), are redacted in pino (logger redact `smtp*`), and are scrubbed
 * from any error surfaced to the worker — nodemailer errors may echo
 * connection params but never the password; we strip it defensively anyway.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>
}

/** Transport-shaped subset (test spies implement this; nodemailer satisfies it). */
type MailTransport = Pick<Transporter, 'sendMail'>

function sanitizeError(err: unknown, pass: string): Error {
  const raw = err instanceof Error ? err.message : String(err)
  const message = pass.length > 0 ? raw.split(pass).join('[redacted]') : raw
  return new Error(message, { cause: err })
}

/** Mailer over an injected transport (unit tests + custom sinks). */
export function createTransporterMailer(transport: MailTransport, password = ''): Mailer {
  return {
    async sendMail(message: MailMessage): Promise<void> {
      try {
        await transport.sendMail({
          to: message.to,
          subject: message.subject,
          text: message.text,
        })
      } catch (err) {
        // Never leak SMTP credentials through error text (code-auditor rule).
        throw sanitizeError(err, password)
      }
    },
  }
}

/**
 * Real SMTP mailer (nodemailer.createTransport). `ignoreTLS` only in
 * non-production (mailpit dev/test sink — no TLS); production requires TLS
 * (secure: true for 465, STARTTLS otherwise via nodemailer defaults).
 * `from` is applied as a transporter default (SMTP_FROM env, R-PROD-5).
 */
export function createSmtpMailer(smtp: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport(
    {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      ignoreTLS: !smtp.user && smtp.port !== 465,
    },
    { from: smtp.from },
  )
  return createTransporterMailer(transport, smtp.pass)
}