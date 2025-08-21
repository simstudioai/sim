import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { Resend } from 'resend'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/email/unsubscribe'
import { getFromEmailAddress } from '@/lib/email/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

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
  useCustomFromFormat?: boolean // If true, uses "from" as-is; if false, uses default FROM_EMAIL_ADDRESS format
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
  useCustomFromFormat: boolean
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

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  try {
    // Check if user has unsubscribed (skip for critical transactional emails)
    if (options.emailType !== 'transactional') {
      const unsubscribeType = options.emailType as 'marketing' | 'updates' | 'notifications'
      // For arrays, check the first email address (batch emails typically go to similar recipients)
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

    // Process email data with unsubscribe tokens and headers
    const processedData = await processEmailData(options)

    // Try Resend first if configured
    if (resend) {
      try {
        return await sendWithResend(processedData)
      } catch (error) {
        logger.warn('Resend failed, attempting Azure Communication Services fallback:', error)
      }
    }

    // Fallback to Azure Communication Services if configured
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

    // No email service configured
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
    useCustomFromFormat = false,
  } = options

  const senderEmail = from || getFromEmailAddress()

  // Generate unsubscribe token and add to content
  let finalHtml = html
  let finalText = text
  const headers: Record<string, string> = {}

  if (includeUnsubscribe && emailType !== 'transactional') {
    // For arrays, use the first email for unsubscribe (batch emails typically go to similar recipients)
    const primaryEmail = Array.isArray(to) ? to[0] : to
    const unsubscribeToken = generateUnsubscribeToken(primaryEmail, emailType)
    const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
    const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}&email=${encodeURIComponent(primaryEmail)}`

    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'

    if (html) {
      finalHtml = html.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
    }
    if (text) {
      finalText = text.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
    }
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
    useCustomFromFormat,
  }
}

async function sendWithResend(data: ProcessedEmailData): Promise<SendEmailResult> {
  if (!resend) throw new Error('Resend not configured')

  const fromAddress = data.useCustomFromFormat ? data.senderEmail : data.senderEmail

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

  // Azure Communication Services requires at least one content type
  if (!data.html && !data.text) {
    throw new Error('Azure Communication Services requires either HTML or text content')
  }

  // For Azure, use just the email address part (no display name)
  // Azure will use the display name configured in the portal for the sender address
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

    // Try Resend first for batch emails if available
    if (resend) {
      try {
        return await sendBatchWithResend(options.emails)
      } catch (error) {
        logger.warn('Resend batch failed, falling back to individual sends:', error)
      }
    }

    // Fallback to individual sends (works with both Azure and Resend)
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
  const batchEmails = emails.map((email) => {
    const senderEmail = email.from || getFromEmailAddress()
    const emailData: any = {
      from: senderEmail,
      to: email.to,
      subject: email.subject,
    }
    if (email.html) emailData.html = email.html
    if (email.text) emailData.text = email.text
    return emailData
  })

  try {
    const response = await resend.batch.send(batchEmails as any)

    if (response.error) {
      throw new Error(response.error.message || 'Resend batch API error')
    }

    // Success - create results for each email
    batchEmails.forEach((_, index) => {
      results.push({
        success: true,
        message: 'Email sent successfully via Resend batch',
        data: { id: `batch-${index}` },
      })
    })

    return {
      success: true,
      message: 'All batch emails sent successfully via Resend',
      results,
      data: { count: results.length },
    }
  } catch (error) {
    logger.error('Resend batch send failed:', error)
    throw error // Let the caller handle fallback
  }
}
