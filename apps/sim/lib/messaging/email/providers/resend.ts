import { Resend } from 'resend'
import { env } from '@/lib/core/config/env'
import type {
  BatchSendEmailResult,
  MailProvider,
  ProcessedEmailData,
  SendEmailResult,
} from '@/lib/messaging/email/types'

function isConfigured(key: string | undefined): key is string {
  return !!key && key !== 'placeholder' && key.trim() !== ''
}

function toResendPayload(data: ProcessedEmailData) {
  return {
    from: data.senderEmail,
    to: data.to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    replyTo: data.replyTo,
    headers: Object.keys(data.headers).length > 0 ? data.headers : undefined,
    attachments: data.attachments?.map((att) => ({
      filename: att.filename,
      content: typeof att.content === 'string' ? att.content : att.content.toString('base64'),
      contentType: att.contentType,
      disposition: att.disposition || 'attachment',
    })),
  }
}

export function createResendProvider(): MailProvider | null {
  if (!isConfigured(env.RESEND_API_KEY)) return null
  const client = new Resend(env.RESEND_API_KEY)

  return {
    name: 'resend',
    async send(data: ProcessedEmailData): Promise<SendEmailResult> {
      const payload = toResendPayload(data)
      const { data: responseData, error } = await client.emails.send(payload as never)
      if (error) {
        throw new Error(error.message || 'Failed to send email via Resend')
      }
      return {
        success: true,
        message: 'Email sent successfully via Resend',
        data: responseData,
      }
    },
    async sendBatch(emails: ProcessedEmailData[]): Promise<BatchSendEmailResult> {
      const payloads = emails.map(toResendPayload)
      const response = await client.batch.send(payloads as never)
      if (response.error) {
        throw new Error(response.error.message || 'Resend batch API error')
      }

      const results: SendEmailResult[] = emails.map((_, index) => ({
        success: true,
        message: 'Email sent successfully via Resend batch',
        data: { id: `batch-${index}` },
      }))

      return {
        success: true,
        message: 'All batch emails sent successfully via Resend',
        results,
        data: { count: emails.length },
      }
    },
  }
}
