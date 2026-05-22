import { createLogger } from '@sim/logger'
import nodemailer from 'nodemailer'
import { env, envBoolean, envNumber } from '@/lib/core/config/env'
import { sendViaNodemailer } from '@/lib/messaging/email/providers/_nodemailer'
import type { MailProvider } from '@/lib/messaging/email/types'

const logger = createLogger('SmtpMailProvider')

export function createSmtpProvider(): MailProvider | null {
  const host = env.SMTP_HOST
  if (!host) return null

  const port = envNumber(env.SMTP_PORT, 0, { min: 1 })
  if (port === 0) {
    logger.warn(
      'SMTP_HOST is set but SMTP_PORT is missing or invalid; skipping SMTP provider. Set SMTP_PORT to 465 (TLS), 587 (STARTTLS), or 25 (plain).'
    )
    return null
  }

  const user = env.SMTP_USER
  const pass = env.SMTP_PASS
  if ((user && !pass) || (!user && pass)) {
    logger.warn(
      'SMTP_USER and SMTP_PASS must both be set for authenticated relays; proceeding without auth.'
    )
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: envBoolean(env.SMTP_SECURE) ?? port === 465,
    auth: user && pass ? { user, pass } : undefined,
  })

  return {
    name: 'smtp',
    send: (data) => sendViaNodemailer(transporter, data, 'smtp'),
  }
}
