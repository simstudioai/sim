import { Resend } from 'resend'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/email/unsubscribe'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { getEmailDomain } from '@/lib/urls/utils'

const logger = createLogger('Mailer')

export type EmailType = 'transactional' | 'marketing' | 'updates' | 'notifications'

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
  emailType?: EmailType
  includeUnsubscribe?: boolean
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

const resendApiKey = env.RESEND_API_KEY

const resend =
  resendApiKey && resendApiKey !== 'placeholder' && resendApiKey.trim() !== ''
    ? new Resend(resendApiKey)
    : null

export async function sendEmail({
  to,
  subject,
  html,
  from,
  emailType = 'transactional',
  includeUnsubscribe = true,
}: EmailOptions): Promise<SendEmailResult> {
  try {
    // Check if user has unsubscribed (skip for critical transactional emails)
    if (emailType !== 'transactional') {
      const unsubscribeType = emailType as 'marketing' | 'updates' | 'notifications'
      const hasUnsubscribed = await isUnsubscribed(to, unsubscribeType)
      if (hasUnsubscribed) {
        logger.info('Email not sent (user unsubscribed):', {
          to,
          subject,
          emailType,
        })
        return {
          success: true,
          message: 'Email skipped (user unsubscribed)',
          data: { id: 'skipped-unsubscribed' },
        }
      }
    }

    const senderEmail = from || `noreply@${getEmailDomain()}`

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

    // Generate unsubscribe token and add to HTML
    let finalHtml = html
    const headers: Record<string, string> = {}

    if (includeUnsubscribe && emailType !== 'transactional') {
      const unsubscribeToken = generateUnsubscribeToken(to, emailType)
      const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}&email=${encodeURIComponent(to)}`

      headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'

      finalHtml = html.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
    }

    const { data, error } = await resend.emails.send({
      from: `Sim Studio <${senderEmail}>`,
      to,
      subject,
      html: finalHtml,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
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
    const senderEmail = `noreply@${getEmailDomain()}`
    const results: SendEmailResult[] = []

    if (!resend) {
      logger.info('Batch emails not sent (Resend not configured):', {
        emailCount: emails.length,
      })

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

    const batchEmails = emails.map((email) => ({
      from: `Sim Studio <${email.from || senderEmail}>`,
      to: email.to,
      subject: email.subject,
      html: email.html,
    }))

    const BATCH_SIZE = 50
    let allSuccessful = true

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    let rateDelay = 500

    for (let i = 0; i < batchEmails.length; i += BATCH_SIZE) {
      if (i > 0) {
        logger.info(`Rate limit protection: Waiting ${rateDelay}ms before sending next batch`)
        await delay(rateDelay)
      }

      const batch = batchEmails.slice(i, i + BATCH_SIZE)

      try {
        logger.info(
          `Sending batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(batchEmails.length / BATCH_SIZE)} (${batch.length} emails)`
        )
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

        // Check if it's a rate limit error
        if (
          error instanceof Error &&
          (error.message.toLowerCase().includes('rate') ||
            error.message.toLowerCase().includes('too many') ||
            error.message.toLowerCase().includes('429'))
        ) {
          logger.warn('Rate limit exceeded, increasing delay and retrying...')

          // Wait a bit longer and try again with this batch
          await delay(rateDelay * 5)

          try {
            logger.info(`Retrying batch ${Math.floor(i / BATCH_SIZE) + 1} with longer delay`)
            const retryResponse = await resend.batch.send(batch)

            if (retryResponse.error) {
              logger.error('Retry failed with error:', retryResponse.error)

              batch.forEach(() => {
                results.push({
                  success: false,
                  message: retryResponse.error?.message || 'Failed to send batch email after retry',
                })
              })

              allSuccessful = false
            } else if (retryResponse.data) {
              if (Array.isArray(retryResponse.data)) {
                retryResponse.data.forEach((item: { id: string }) => {
                  results.push({
                    success: true,
                    message: 'Email sent successfully on retry',
                    data: item,
                  })
                })
              } else {
                batch.forEach((_, index) => {
                  results.push({
                    success: true,
                    message: 'Email sent successfully on retry',
                    data: { id: `retry-batch-${i}-item-${index}` },
                  })
                })
              }

              // Increase the standard delay since we hit a rate limit
              logger.info('Increasing delay between batches after rate limit hit')
              rateDelay = rateDelay * 2
            }
          } catch (retryError) {
            logger.error('Retry also failed:', retryError)

            batch.forEach(() => {
              results.push({
                success: false,
                message:
                  retryError instanceof Error
                    ? retryError.message
                    : 'Failed to send email even after retry',
              })
            })

            allSuccessful = false
          }
        } else {
          // Non-rate limit error
          batch.forEach(() => {
            results.push({
              success: false,
              message: error instanceof Error ? error.message : 'Failed to send batch email',
            })
          })

          allSuccessful = false
        }
      }
    }

    return {
      success: allSuccessful,
      message: allSuccessful
        ? 'All batch emails sent successfully'
        : 'Some batch emails failed to send',
      results,
      data: { count: results.filter((r) => r.success).length },
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
