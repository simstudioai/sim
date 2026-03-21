import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { createLogger } from '@sim/logger'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/messaging/email/unsubscribe'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('Mailer')

export type EmailType = 'transactional' | 'marketing' | 'updates' | 'notifications'

export interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType: string
  disposition?: 'attachment' | 'inline'
}

export interface EmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  emailType?: EmailType
  includeUnsubscribe?: boolean
  attachments?: EmailAttachment[]
  replyTo?: string
}

export interface BatchEmailOptions {
  emails: EmailOptions[]
}

export interface SendEmailResult {
  success: boolean
  message: string
  data?: any
}

export interface BatchSendEmailResult {
  success: boolean
  message: string
  results: SendEmailResult[]
  data?: any
}

interface ProcessedEmailData {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  senderEmail: string
  headers: Record<string, string>
  attachments?: EmailAttachment[]
  replyTo?: string
}

type SmtpSecureMode = 'TLS' | 'SSL' | 'None'

interface SmtpConfig {
  host: string
  port: number
  secureMode: SmtpSecureMode
  username?: string
  password?: string
}

interface EmailProvider {
  name: string
  send: (data: ProcessedEmailData) => Promise<SendEmailResult>
}

const resendApiKey = env.RESEND_API_KEY
const azureConnectionString = env.AZURE_ACS_CONNECTION_STRING

const resend =
  resendApiKey && resendApiKey !== 'placeholder' && resendApiKey.trim() !== ''
    ? new Resend(resendApiKey)
    : null

const azureEmailClient =
  azureConnectionString && azureConnectionString.trim() !== ''
    ? new EmailClient(azureConnectionString)
    : null

const smtpConfig = getSmtpConfig()

const smtpTransporter = smtpConfig ? createSmtpTransporter(smtpConfig) : null

const emailProviders = getEmailProviders()

warnOnMultipleProviders(emailProviders)

/**
 * Check if any email service is configured and available
 */
export function hasEmailService(): boolean {
  return emailProviders.length > 0
}

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  try {
    if (options.emailType !== 'transactional') {
      const unsubscribeType = options.emailType as 'marketing' | 'updates' | 'notifications'
      const primaryEmail = Array.isArray(options.to) ? options.to[0] : options.to
      const hasUnsubscribed = await isUnsubscribed(primaryEmail, unsubscribeType)
      if (hasUnsubscribed) {
        logger.info('Email not sent (user unsubscribed):', {
          to: options.to,
          subject: options.subject,
          emailType: options.emailType,
        })
        return {
          success: true,
          message: 'Email skipped (user unsubscribed)',
          data: { id: 'skipped-unsubscribed' },
        }
      }
    }

    const processedData = await processEmailData(options)

    if (emailProviders.length === 0) {
      logger.info('Email not sent (no email service configured):', {
        to: options.to,
        subject: options.subject,
        from: processedData.senderEmail,
      })
      return {
        success: true,
        message: 'Email logging successful (no email service configured)',
        data: { id: 'mock-email-id' },
      }
    }

    const failedProviders: string[] = []

    for (const provider of emailProviders) {
      try {
        return await provider.send(processedData)
      } catch (error) {
        failedProviders.push(provider.name)
        logger.warn(`${provider.name} failed, attempting next email provider:`, error)
      }
    }

    logger.error('All configured email providers failed:', { failedProviders })
    return {
      success: false,
      message: `${failedProviders.join(', ')} failed`,
    }
  } catch (error) {
    logger.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
  }
}

function getEmailProviders(): EmailProvider[] {
  const providers: EmailProvider[] = []

  if (resend) {
    providers.push({
      name: 'Resend',
      send: sendWithResend,
    })
  }

  if (azureEmailClient) {
    providers.push({
      name: 'Azure Communication Services',
      send: sendWithAzure,
    })
  }

  if (smtpTransporter) {
    providers.push({
      name: 'SMTP',
      send: sendWithSmtp,
    })
  }

  return providers
}

function warnOnMultipleProviders(providers: EmailProvider[]): void {
  if (providers.length <= 1) {
    return
  }

  logger.warn('Multiple email providers configured; earlier providers take precedence', {
    providerOrder: providers.map((provider) => provider.name),
  })
}

function getSmtpConfig(): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  const portValue = env.SMTP_PORT?.trim()
  const username = env.SMTP_USERNAME?.trim()
  const password = env.SMTP_PASSWORD?.trim()

  if (!host && !portValue && !username && !password) {
    return null
  }

  if (!host || !portValue) {
    logger.warn('SMTP configuration ignored because host or port is missing')
    return null
  }

  if (!/^\d+$/.test(portValue)) {
    logger.warn('SMTP configuration ignored because port is invalid', { port: portValue })
    return null
  }

  const port = Number(portValue)
  if (port < 1 || port > 65535) {
    logger.warn('SMTP configuration ignored because port is invalid', { port: portValue })
    return null
  }

  if ((username && !password) || (!username && password)) {
    logger.warn('SMTP configuration ignored because username/password are incomplete')
    return null
  }

  return {
    host,
    port,
    secureMode: normalizeSmtpSecureMode(env.SMTP_SECURE, port),
    username,
    password,
  }
}

function normalizeSmtpSecureMode(
  secureMode: string | undefined,
  port: number
): SmtpSecureMode {
  const normalized = secureMode?.trim().toUpperCase()

  if (normalized === 'TLS' || normalized === 'SSL') {
    return normalized
  }

  if (normalized === 'NONE') {
    return 'None'
  }

  if (port === 465) {
    return 'SSL'
  }

  if (port === 587) {
    return 'TLS'
  }

  return 'None'
}

function createSmtpTransporter(config: SmtpConfig) {
  const baseTransport = {
    host: config.host,
    port: config.port,
    secure: config.secureMode === 'SSL',
    requireTLS: config.secureMode === 'TLS',
    ignoreTLS: config.secureMode === 'None',
    tls: {
      rejectUnauthorized: config.secureMode !== 'None',
    },
  }

  if (config.username && config.password) {
    return nodemailer.createTransport({
      ...baseTransport,
      auth: {
        user: config.username,
        pass: config.password,
      },
    })
  }

  return nodemailer.createTransport(baseTransport)
}

interface UnsubscribeData {
  headers: Record<string, string>
  html?: string
  text?: string
}

function addUnsubscribeData(
  recipientEmail: string,
  emailType: string,
  html?: string,
  text?: string
): UnsubscribeData {
  const unsubscribeToken = generateUnsubscribeToken(recipientEmail, emailType)
  const baseUrl = getBaseUrl()
  const encodedEmail = encodeURIComponent(recipientEmail)
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}&email=${encodedEmail}`

  return {
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    html: html
      ?.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
      .replace(/\{\{UNSUBSCRIBE_EMAIL\}\}/g, encodedEmail),
    text: text
      ?.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
      .replace(/\{\{UNSUBSCRIBE_EMAIL\}\}/g, encodedEmail),
  }
}

async function processEmailData(options: EmailOptions): Promise<ProcessedEmailData> {
  const {
    to,
    subject,
    html,
    text,
    from,
    emailType = 'transactional',
    includeUnsubscribe = true,
    attachments,
    replyTo,
  } = options

  const senderEmail = from || getFromEmailAddress()

  let finalHtml = html
  let finalText = text
  let headers: Record<string, string> = {}

  if (includeUnsubscribe && emailType !== 'transactional') {
    const primaryEmail = Array.isArray(to) ? to[0] : to
    const unsubData = addUnsubscribeData(primaryEmail, emailType, html, text)
    headers = unsubData.headers
    finalHtml = unsubData.html
    finalText = unsubData.text
  }

  return {
    to,
    subject,
    html: finalHtml,
    text: finalText,
    senderEmail,
    headers,
    attachments,
    replyTo,
  }
}

async function sendWithResend(data: ProcessedEmailData): Promise<SendEmailResult> {
  if (!resend) throw new Error('Resend not configured')

  const fromAddress = data.senderEmail

  const emailData: any = {
    from: fromAddress,
    to: data.to,
    subject: data.subject,
    headers: Object.keys(data.headers).length > 0 ? data.headers : undefined,
  }

  if (data.html) emailData.html = data.html
  if (data.text) emailData.text = data.text
  if (data.replyTo) emailData.replyTo = data.replyTo
  if (data.attachments) {
    emailData.attachments = data.attachments.map((att) => ({
      filename: att.filename,
      content: typeof att.content === 'string' ? att.content : att.content.toString('base64'),
      contentType: att.contentType,
      disposition: att.disposition || 'attachment',
    }))
  }

  const { data: responseData, error } = await resend.emails.send(emailData)

  if (error) {
    throw new Error(error.message || 'Failed to send email via Resend')
  }

  return {
    success: true,
    message: 'Email sent successfully via Resend',
    data: responseData,
  }
}

async function sendWithAzure(data: ProcessedEmailData): Promise<SendEmailResult> {
  if (!azureEmailClient) throw new Error('Azure Communication Services not configured')

  if (!data.html && !data.text) {
    throw new Error('Azure Communication Services requires either HTML or text content')
  }

  const senderEmailOnly = data.senderEmail.includes('<')
    ? data.senderEmail.match(/<(.+)>/)?.[1] || data.senderEmail
    : data.senderEmail

  const message: EmailMessage = {
    senderAddress: senderEmailOnly,
    content: data.html
      ? {
          subject: data.subject,
          html: data.html,
        }
      : {
          subject: data.subject,
          plainText: data.text!,
        },
    recipients: {
      to: Array.isArray(data.to)
        ? data.to.map((email) => ({ address: email }))
        : [{ address: data.to }],
    },
    headers: data.headers,
  }

  const poller = await azureEmailClient.beginSend(message)
  const result = await poller.pollUntilDone()

  if (result.status === 'Succeeded') {
    return {
      success: true,
      message: 'Email sent successfully via Azure Communication Services',
      data: { id: result.id },
    }
  }
  throw new Error(`Azure Communication Services failed with status: ${result.status}`)
}

async function sendWithSmtp(data: ProcessedEmailData): Promise<SendEmailResult> {
  if (!smtpTransporter) throw new Error('SMTP not configured')

  const mailOptions: nodemailer.SendMailOptions = {
    from: data.senderEmail,
    to: data.to,
    subject: data.subject,
    headers: Object.keys(data.headers).length > 0 ? data.headers : undefined,
    replyTo: data.replyTo,
  }

  if (data.html) mailOptions.html = data.html
  if (data.text) mailOptions.text = data.text
  if (data.attachments) {
    mailOptions.attachments = data.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
      contentDisposition: attachment.disposition || 'attachment',
    }))
  }

  const result = await smtpTransporter.sendMail(mailOptions)

  return {
    success: true,
    message: 'Email sent successfully via SMTP',
    data: { id: result.messageId },
  }
}

export async function sendBatchEmails(options: BatchEmailOptions): Promise<BatchSendEmailResult> {
  try {
    const results: SendEmailResult[] = []

    if (resend) {
      try {
        return await sendBatchWithResend(options.emails)
      } catch (error) {
        logger.warn('Resend batch failed, falling back to individual sends:', error)
      }
    }

    logger.info('Sending batch emails individually')
    for (const email of options.emails) {
      try {
        const result = await sendEmail(email)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to send email',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    return {
      success: successCount === results.length,
      message:
        successCount === results.length
          ? 'All batch emails sent successfully'
          : `${successCount}/${results.length} emails sent successfully`,
      results,
      data: { count: successCount },
    }
  } catch (error) {
    logger.error('Error in batch email sending:', error)
    return {
      success: false,
      message: 'Failed to send batch emails',
      results: [],
    }
  }
}

async function sendBatchWithResend(emails: EmailOptions[]): Promise<BatchSendEmailResult> {
  if (!resend) throw new Error('Resend not configured')

  const results: SendEmailResult[] = []
  const skippedIndices: number[] = []
  const batchEmails: any[] = []

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]
    const { emailType = 'transactional', includeUnsubscribe = true } = email

    if (emailType !== 'transactional') {
      const unsubscribeType = emailType as 'marketing' | 'updates' | 'notifications'
      const primaryEmail = Array.isArray(email.to) ? email.to[0] : email.to
      const hasUnsubscribed = await isUnsubscribed(primaryEmail, unsubscribeType)
      if (hasUnsubscribed) {
        skippedIndices.push(i)
        results.push({
          success: true,
          message: 'Email skipped (user unsubscribed)',
          data: { id: 'skipped-unsubscribed' },
        })
        continue
      }
    }

    const senderEmail = email.from || getFromEmailAddress()
    const emailData: any = {
      from: senderEmail,
      to: email.to,
      subject: email.subject,
    }

    if (includeUnsubscribe && emailType !== 'transactional') {
      const primaryEmail = Array.isArray(email.to) ? email.to[0] : email.to
      const unsubData = addUnsubscribeData(primaryEmail, emailType, email.html, email.text)
      emailData.headers = unsubData.headers
      if (unsubData.html) emailData.html = unsubData.html
      if (unsubData.text) emailData.text = unsubData.text
    } else {
      if (email.html) emailData.html = email.html
      if (email.text) emailData.text = email.text
    }

    batchEmails.push(emailData)
  }

  if (batchEmails.length === 0) {
    return {
      success: true,
      message: 'All batch emails skipped (users unsubscribed)',
      results,
      data: { count: 0 },
    }
  }

  try {
    const response = await resend.batch.send(batchEmails as any)

    if (response.error) {
      throw new Error(response.error.message || 'Resend batch API error')
    }

    batchEmails.forEach((_, index) => {
      results.push({
        success: true,
        message: 'Email sent successfully via Resend batch',
        data: { id: `batch-${index}` },
      })
    })

    return {
      success: true,
      message:
        skippedIndices.length > 0
          ? `${batchEmails.length} emails sent, ${skippedIndices.length} skipped (unsubscribed)`
          : 'All batch emails sent successfully via Resend',
      results,
      data: { count: batchEmails.length },
    }
  } catch (error) {
    logger.error('Resend batch send failed:', error)
    throw error
  }
}
