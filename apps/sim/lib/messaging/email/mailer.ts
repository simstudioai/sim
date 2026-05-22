import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { processEmailData, shouldSkipForUnsubscribe } from '@/lib/messaging/email/prepare'
import { activeProviders } from '@/lib/messaging/email/providers'
import type {
  BatchEmailOptions,
  BatchSendEmailResult,
  EmailOptions,
  ProcessedEmailData,
  SendEmailResult,
} from '@/lib/messaging/email/types'

export type {
  BatchEmailOptions,
  BatchSendEmailResult,
  EmailAttachment,
  EmailOptions,
  EmailType,
  MailProvider,
  MailProviderName,
  ProcessedEmailData,
  SendEmailResult,
} from '@/lib/messaging/email/types'

const logger = createLogger('Mailer')

const SKIPPED_UNSUBSCRIBED_RESULT: SendEmailResult = {
  success: true,
  message: 'Email skipped (user unsubscribed)',
  data: { id: 'skipped-unsubscribed' },
}

const MOCK_EMAIL_RESULT: SendEmailResult = {
  success: true,
  message: 'Email logging successful (no email service configured)',
  data: { id: 'mock-email-id' },
}

/**
 * True when at least one email provider is configured via env vars.
 */
export function hasEmailService(): boolean {
  return activeProviders.length > 0
}

/**
 * Send a single email. Iterates configured providers in priority order
 * (resend → ses → smtp → azure) and falls back to the next on error.
 * Returns a successful "logged" result when no provider is configured,
 * so dev environments don't break on missing email creds.
 */
export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  try {
    if (await shouldSkipForUnsubscribe(options)) {
      logger.info('Email not sent (user unsubscribed):', {
        to: options.to,
        subject: options.subject,
        emailType: options.emailType,
      })
      return SKIPPED_UNSUBSCRIBED_RESULT
    }

    const data = processEmailData(options)

    if (activeProviders.length === 0) {
      logger.info('Email not sent (no email service configured):', {
        to: data.to,
        subject: data.subject,
        from: data.senderEmail,
      })
      return MOCK_EMAIL_RESULT
    }

    return await dispatchWithFallback(data)
  } catch (error) {
    logger.error('Error sending email:', error)
    return { success: false, message: 'Failed to send email' }
  }
}

async function dispatchWithFallback(data: ProcessedEmailData): Promise<SendEmailResult> {
  let lastError: unknown
  for (const provider of activeProviders) {
    try {
      return await provider.send(data)
    } catch (error) {
      lastError = error
      logger.warn(`${provider.name} failed, trying next provider`, error)
    }
  }
  logger.error('All email providers failed', lastError)
  return {
    success: false,
    message: `All email providers failed: ${getErrorMessage(lastError, 'unknown error')}`,
  }
}

interface PreparedBatchEntry {
  index: number
  data: ProcessedEmailData | null
  skippedResult: SendEmailResult | null
}

async function prepareBatch(emails: EmailOptions[]): Promise<PreparedBatchEntry[]> {
  return Promise.all(
    emails.map(async (email, index) => {
      if (await shouldSkipForUnsubscribe(email)) {
        return { index, data: null, skippedResult: SKIPPED_UNSUBSCRIBED_RESULT }
      }
      try {
        return { index, data: processEmailData(email), skippedResult: null }
      } catch (error) {
        return {
          index,
          data: null,
          skippedResult: {
            success: false,
            message: getErrorMessage(error, 'Failed to prepare email'),
          },
        }
      }
    })
  )
}

/**
 * Send a batch of emails. Uses the first configured provider with a
 * native `sendBatch` capability (currently only Resend); falls back to
 * per-message sends for providers without batch support, or if the
 * batch call itself fails.
 */
export async function sendBatchEmails(options: BatchEmailOptions): Promise<BatchSendEmailResult> {
  try {
    const entries = await prepareBatch(options.emails)
    const sendable = entries.filter(
      (e): e is PreparedBatchEntry & { data: ProcessedEmailData } => e.data !== null
    )

    if (sendable.length === 0) {
      const results = entries.map((e) => e.skippedResult ?? SKIPPED_UNSUBSCRIBED_RESULT)
      return {
        success: results.every((r) => r.success),
        message:
          options.emails.length === 0
            ? 'No emails to send'
            : 'All batch emails skipped (users unsubscribed)',
        results,
        data: { count: 0 },
      }
    }

    const batchProvider = activeProviders.find((p) => p.sendBatch)
    if (batchProvider) {
      try {
        const batchResult = await batchProvider.sendBatch!(sendable.map((e) => e.data))
        return mergeBatchResults(entries, sendable, batchResult.results)
      } catch (error) {
        logger.warn(`${batchProvider.name} batch failed, falling back to per-message sends`, error)
      }
    }

    const sentResults = await Promise.all(
      sendable.map((entry) => sendEmail(options.emails[entry.index]))
    )
    return mergeBatchResults(entries, sendable, sentResults)
  } catch (error) {
    logger.error('Error in batch email sending:', error)
    return { success: false, message: 'Failed to send batch emails', results: [] }
  }
}

function mergeBatchResults(
  entries: PreparedBatchEntry[],
  sendable: PreparedBatchEntry[],
  sentResults: SendEmailResult[]
): BatchSendEmailResult {
  const resultsByIndex = new Map<number, SendEmailResult>()
  sendable.forEach((entry, i) => {
    resultsByIndex.set(entry.index, sentResults[i])
  })

  const results = entries.map(
    (entry) => resultsByIndex.get(entry.index) ?? entry.skippedResult ?? SKIPPED_UNSUBSCRIBED_RESULT
  )

  const successCount = results.filter((r) => r.success).length
  const skippedCount = entries.length - sendable.length
  return {
    success: successCount === results.length,
    message:
      skippedCount > 0
        ? `${sendable.length} emails sent, ${skippedCount} skipped`
        : successCount === results.length
          ? 'All batch emails sent successfully'
          : `${successCount}/${results.length} emails sent successfully`,
    results,
    data: { count: successCount },
  }
}
