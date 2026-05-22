import type { Transporter } from 'nodemailer'
import type {
  MailProviderName,
  ProcessedEmailData,
  SendEmailResult,
} from '@/lib/messaging/email/types'

export async function sendViaNodemailer(
  transporter: Transporter,
  data: ProcessedEmailData,
  provider: MailProviderName
): Promise<SendEmailResult> {
  const info = await transporter.sendMail({
    from: data.senderEmail,
    to: data.to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    replyTo: data.replyTo,
    headers: Object.keys(data.headers).length > 0 ? data.headers : undefined,
    attachments: data.attachments?.map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
      contentDisposition: att.disposition || 'attachment',
    })),
  })

  return {
    success: true,
    message: `Email sent successfully via ${provider}`,
    data: { id: info.messageId },
  }
}
