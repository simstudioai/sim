import { Resend } from 'resend'
import { createLogger } from '@/lib/logs/console-logger'

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
}

interface SendEmailResult {
  success: boolean
  message: string
  data?: any
}

const logger = createLogger('Mailer')

const resendApiKey = process.env.RESEND_API_KEY
const resend =
  resendApiKey && resendApiKey !== 'placeholder' && resendApiKey.trim() !== ''
    ? new Resend(resendApiKey)
    : null

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: EmailOptions): Promise<SendEmailResult> {
  try {
    const senderEmail = from || 'noreply@simstudio.ai'

    if (!resend) {
      logger.info('Email not sent (Resend not configured):', {
        to,
        subject,
        from: senderEmail,
      })
      return {
        success: true,
        message: 'Email logging successful (Resend not configured)',
        data: { id: 'mock-email-id' },
      }
    }

    const { data, error } = await resend.emails.send({
      from: `Sim Studio <${senderEmail}>`,
      to,
      subject,
      html,
    })

    if (error) {
      logger.error('Resend API error:', error)
      return {
        success: false,
        message: error.message || 'Failed to send email',
      }
    }

    return {
      success: true,
      message: 'Email sent successfully',
      data,
    }
  } catch (error) {
    logger.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
  }
}
