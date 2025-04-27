import { Resend } from 'resend'
import { createLogger } from '@/lib/logs/console-logger'

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
}

interface BatchEmailOptions {
  emails: EmailOptions[]
}

interface SendEmailResult {
  success: boolean
  message: string
  data?: any
}

interface BatchSendEmailResult {
  success: boolean
  message: string
  results: SendEmailResult[]
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

export async function sendBatchEmails({
  emails,
}: BatchEmailOptions): Promise<BatchSendEmailResult> {
  try {
    const senderEmail = 'noreply@simstudio.ai'
    const results: SendEmailResult[] = []

    if (!resend) {
      logger.info('Batch emails not sent (Resend not configured):', {
        emailCount: emails.length,
      })
      
      // Create mock results for each email
      emails.forEach(() => {
        results.push({
          success: true,
          message: 'Email logging successful (Resend not configured)',
          data: { id: 'mock-email-id' },
        })
      })
      
      return {
        success: true,
        message: 'Batch email logging successful (Resend not configured)',
        results,
        data: { ids: Array(emails.length).fill('mock-email-id') },
      }
    }

    // Prepare emails for batch sending
    const batchEmails = emails.map(email => ({
      from: `Sim Studio <${email.from || senderEmail}>`,
      to: email.to,
      subject: email.subject,
      html: email.html,
    }))

    // Send batch emails (maximum 100 per batch as per Resend API limits)
    // Process in chunks of 50 to be safe
    const BATCH_SIZE = 50
    let allSuccessful = true
    
    for (let i = 0; i < batchEmails.length; i += BATCH_SIZE) {
      const batch = batchEmails.slice(i, i + BATCH_SIZE)
      
      try {
        const response = await resend.batch.send(batch)
        
        if (response.error) {
          logger.error('Resend batch API error:', response.error)
          
          // Add failure results for this batch
          batch.forEach(() => {
            results.push({
              success: false,
              message: response.error?.message || 'Failed to send batch email',
            })
          })
          
          allSuccessful = false
        } else if (response.data) {
          if (Array.isArray(response.data)) {
            response.data.forEach((item: { id: string }) => {
              results.push({
                success: true,
                message: 'Email sent successfully',
                data: item,
              })
            })
          } else {
            logger.info('Resend batch API returned unexpected format, assuming success')
            batch.forEach((_, index) => {
              results.push({
                success: true,
                message: 'Email sent successfully',
                data: { id: `batch-${i}-item-${index}` },
              })
            })
          }
        }
      } catch (error) {
        logger.error('Error sending batch emails:', error)
        
        // Add failure results for this batch
        batch.forEach(() => {
          results.push({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to send batch email',
          })
        })
        
        allSuccessful = false
      }
    }

    return {
      success: allSuccessful,
      message: allSuccessful 
        ? 'All batch emails sent successfully' 
        : 'Some batch emails failed to send',
      results,
      data: { count: results.filter(r => r.success).length },
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
