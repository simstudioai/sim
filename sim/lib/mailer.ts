import { Resend } from 'resend'

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

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: EmailOptions): Promise<SendEmailResult> {
  try {
    const senderEmail = from || 'noreply@simstudio.ai'

    const { data, error } = await resend.emails.send({
      from: `Sim Studio <${senderEmail}>`,
      to,
      subject,
      html,
    })

    if (error) {
      console.error('Resend API error:', error)
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
    console.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
  }
}
