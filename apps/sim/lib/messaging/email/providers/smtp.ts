import nodemailer from 'nodemailer'
import { env, envBoolean, envNumber } from '@/lib/core/config/env'
import { sendViaNodemailer } from '@/lib/messaging/email/providers/_nodemailer'
import type { MailProvider } from '@/lib/messaging/email/types'

export function createSmtpProvider(): MailProvider | null {
  const host = env.SMTP_HOST
  if (!host) return null

  const port = envNumber(env.SMTP_PORT, 0, { min: 1 })
  if (port === 0) return null

  const user = env.SMTP_USER
  const pass = env.SMTP_PASS
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
