import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
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

const SKIPPED_BANNED_RESULT: SendEmailResult = {
  success: true,
  message: 'Email skipped (recipient on access-control ban list)',
  data: { id: 'skipped-banned' },
}

export function hasEmailService(): boolean {
  return activeProviders.length > 0
}

/**
 * Drop recipients that are on the AppConfig access-control ban list. Returns the
 * original options when nothing is banned, options narrowed to the allowed
 * recipients when some are, or `null` when every recipient is banned. Config is
 * cached (~30s TTL) with an env fallback, so a missing/unreachable AppConfig
 * fails open rather than blocking all mail.
 */
async function applyBanList(options: EmailOptions): Promise<EmailOptions | null> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to]
  const config = await getAccessControlConfig()
  const allowed = recipients.filter((email) => !isEmailBlockedByAccessControl(email, config))
  if (allowed.length === 0) return null
  if (allowed.length === recipients.length) return options
  return { ...options, to: allowed.length === 1 ? allowed[0] : allowed }
}

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  try {
    const allowed = await applyBanList(options)
    if (!allowed) {
      logger.info('Email not sent (recipient on access-control ban list):', {
        to: options.to,
        subject: options.subject,
        emailType: options.emailType,
      })
      return SKIPPED_BANNED_RESULT
    }

    if (await shouldSkipForUnsubscribe(allowed)) {
      logger.info('Email not sent (user unsubscribed):', {
        to: allowed.to,
        subject: allowed.subject,
        emailType: allowed.emailType,
      })
      return SKIPPED_UNSUBSCRIBED_RESULT
    }

    const data = processEmailData(allowed)

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
    emails.map(async (email, index): Promise<PreparedBatchEntry> => {
      try {
        const allowed = await applyBanList(email)
        if (!allowed) {
          return { index, data: null, skippedResult: SKIPPED_BANNED_RESULT }
        }
        if (await shouldSkipForUnsubscribe(allowed)) {
          return { index, data: null, skippedResult: SKIPPED_UNSUBSCRIBED_RESULT }
        }
        return { index, data: processEmailData(allowed), skippedResult: null }
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

export async function sendBatchEmails(options: BatchEmailOptions): Promise<BatchSendEmailResult> {
  try {
    const entries = await prepareBatch(options.emails)
    const sendable = entries.filter(
      (e): e is PreparedBatchEntry & { data: ProcessedEmailData } => e.data !== null
    )

    if (sendable.length === 0) {
      const results = entries.map((e) => e.skippedResult ?? SKIPPED_UNSUBSCRIBED_RESULT)
      const allUnsubscribed =
        entries.length > 0 && entries.every((e) => e.skippedResult === SKIPPED_UNSUBSCRIBED_RESULT)
      return {
        success: results.every((r) => r.success),
        message:
          options.emails.length === 0
            ? 'No emails to send'
            : allUnsubscribed
              ? 'All batch emails skipped (users unsubscribed)'
              : 'No emails sent (all entries skipped or failed validation)',
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

  // sentCount excludes both unsubscribe-skipped (success but not delivered)
  // and prepare-failed entries — only counts what actually went out the wire.
  const sentCount = sentResults.filter((r) => r.success).length
  const skippedCount = entries.length - sendable.length
  const allSucceeded = sentCount === sendable.length && skippedCount === 0
  return {
    success: results.every((r) => r.success),
    message:
      skippedCount > 0
        ? `${sentCount} emails sent, ${skippedCount} skipped`
        : allSucceeded
          ? 'All batch emails sent successfully'
          : `${sentCount}/${sendable.length} emails sent successfully`,
    results,
    data: { count: sentCount },
  }
}
