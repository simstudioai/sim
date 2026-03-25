import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { createLogger } from '@sim/logger'
import { Resend } from 'resend'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/messaging/email/unsubscribe'
import { getFromEmailAddress, hasEmailHeaderControlChars } from '@/lib/messaging/email/utils'

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

interface PreparedEmailHeaderData {
  to: string | string[]
  subject: string
  senderEmail: string
  replyTo?: string
}

function sanitizeEmailSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ').trim()
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

/**
 * Check if any email service is configured and available
 */
export function hasEmailService(): boolean {
  return !!(resend || azureEmailClient)
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

    if (resend) {
      try {
        return await sendWithResend(processedData)
      } catch (error) {
        logger.warn('Resend failed, attempting Azure Communication Services fallback:', error)
      }
    }

    if (azureEmailClient) {
      try {
        return await sendWithAzure(processedData)
      } catch (error) {
        logger.error('Azure Communication Services also failed:', error)
        return {
          success: false,
          message: 'Both Resend and Azure Communication Services failed',
        }
      }
    }

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
  } catch (error) {
    logger.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
  }
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
    html,
    text,
    emailType = 'transactional',
    includeUnsubscribe = true,
    attachments,
  } = options

  const preparedHeaders = prepareEmailHeaders(options)

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
    to: preparedHeaders.to,
    subject: preparedHeaders.subject,
    html: finalHtml,
    text: finalText,
    senderEmail: preparedHeaders.senderEmail,
    headers,
    attachments,
    replyTo: preparedHeaders.replyTo,
  }
}

function prepareEmailHeaders(options: EmailOptions): PreparedEmailHeaderData {
  const senderEmail = options.from || getFromEmailAddress()
  const recipients = Array.isArray(options.to) ? options.to : [options.to]

  if (recipients.some(hasEmailHeaderControlChars)) {
    throw new Error('Invalid recipient email header')
  }

  if (hasEmailHeaderControlChars(senderEmail)) {
    throw new Error('Invalid from email header')
  }

  if (options.replyTo && hasEmailHeaderControlChars(options.replyTo)) {
    throw new Error('Invalid reply-to email header')
  }

  const subject = sanitizeEmailSubject(options.subject)
  if (subject.length === 0) {
    throw new Error('Email subject cannot be empty')
  }

  return {
    to: options.to,
    subject,
    senderEmail,
    replyTo: options.replyTo,
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

    const preparedHeaders = prepareEmailHeaders(email)
    const emailData: any = {
      from: preparedHeaders.senderEmail,
      to: preparedHeaders.to,
      subject: preparedHeaders.subject,
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
