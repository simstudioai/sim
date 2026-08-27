import { createLogger } from '@sim/logger'
import nodemailer from 'nodemailer'

const logger = createLogger('SmtpClient')

export interface SmtpClientConfig {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  name?: string
  tls: { rejectUnauthorized: boolean; servername: string }
}

function closeTransporter(transporter: nodemailer.Transporter): void {
  try {
    transporter.close()
  } catch (error) {
    logger.warn('Failed to close SMTP transporter', { error })
  }
}

export async function sendSmtpMessage(
  config: SmtpClientConfig,
  message: nodemailer.SendMailOptions,
  signal?: AbortSignal
): Promise<{ messageId?: string }> {
  signal?.throwIfAborted()
  const transporter = nodemailer.createTransport(config)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    closeTransporter(transporter)
  }
  const abort = () => close()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await transporter.sendMail(message)
    signal?.throwIfAborted()
    return { messageId: result.messageId }
  } finally {
    signal?.removeEventListener('abort', abort)
    close()
  }
}
