import { pollingIdempotency } from '@/lib/core/idempotency/service'
import type { PollingProviderHandler, PollWebhookContext } from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  resolveOAuthCredential,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'
import type { GmailAttachment } from '@/tools/gmail/types'
import { downloadAttachments, extractAttachmentInfo } from '@/tools/gmail/utils'

interface GmailWebhookConfig {
  labelIds: string[]
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE'
  markAsRead: boolean
  searchQuery?: string
  maxEmailsPerPoll?: number
  lastCheckedTimestamp?: string
  historyId?: string
  includeAttachments?: boolean
  includeRawEmail?: boolean
}

interface GmailEmail {
  id: string
  threadId: string
  historyId?: string
  labelIds?: string[]
  payload?: Record<string, unknown>
  snippet?: string
  internalDate?: string
}

export interface SimplifiedEmail {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  cc: string
  date: string | null
  bodyText: string
  bodyHtml: string
  labels: string[]
  hasAttachments: boolean
  attachments: GmailAttachment[]
}

export interface GmailWebhookPayload {
  email: SimplifiedEmail
  timestamp: string
  rawEmail?: GmailEmail
}

export const gmailPollingHandler: PollingProviderHandler = {
  provider: 'gmail',
  label: 'Gmail',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const accessToken = await resolveOAuthCredential(
        webhookData,
        'google-email',
        requestId,
        logger
      )

      const config = webhookData.providerConfig as unknown as GmailWebhookConfig
      const now = new Date()

      const { emails, latestHistoryId } = await fetchNewEmails(
        accessToken,
        config,
        requestId,
        logger
      )

      if (!emails || !emails.length) {
        await updateWebhookProviderConfig(
          webhookId,
          {
            lastCheckedTimestamp: now.toISOString(),
            ...(latestHistoryId || config.historyId
              ? { historyId: latestHistoryId || config.historyId }
              : {}),
          },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
        return 'success'
      }

      logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)

      const { processedCount, failedCount } = await processEmails(
        emails,
        webhookData,
        workflowData,
        config,
        accessToken,
        requestId,
        logger
      )

      await updateWebhookProviderConfig(
        webhookId,
        {
          lastCheckedTimestamp: now.toISOString(),
          ...(latestHistoryId || config.historyId
            ? { historyId: latestHistoryId || config.historyId }
            : {}),
        },
        logger
      )

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(
          `[${requestId}] All ${failedCount} emails failed to process for webhook ${webhookId}`
        )
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `[${requestId}] Successfully processed ${processedCount} emails for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      logger.error(`[${requestId}] Error processing Gmail webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function fetchNewEmails(
  accessToken: string,
  config: GmailWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
) {
  try {
    const useHistoryApi = !!config.historyId
    let emails: GmailEmail[] = []
    let latestHistoryId = config.historyId

    if (useHistoryApi) {
      const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${config.historyId}`

      const historyResponse = await fetch(historyUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!historyResponse.ok) {
        const errorData = await historyResponse.json()
        logger.error(`[${requestId}] Gmail history API error:`, {
          status: historyResponse.status,
          statusText: historyResponse.statusText,
          error: errorData,
        })

        logger.info(`[${requestId}] Falling back to search API after history API failure`)
        return searchEmails(accessToken, config, requestId, logger)
      }

      const historyData = await historyResponse.json()

      if (!historyData.history || !historyData.history.length) {
        return { emails: [], latestHistoryId }
      }

      if (historyData.historyId) {
        latestHistoryId = historyData.historyId
      }

      const messageIds = new Set<string>()
      for (const history of historyData.history) {
        if (history.messagesAdded) {
          for (const messageAdded of history.messagesAdded) {
            messageIds.add(messageAdded.message.id)
          }
        }
      }

      if (messageIds.size === 0) {
        return { emails: [], latestHistoryId }
      }

      const sortedIds = [...messageIds].sort().reverse()
      const idsToFetch = sortedIds.slice(0, config.maxEmailsPerPoll || 25)
      logger.info(`[${requestId}] Processing ${idsToFetch.length} emails from history API`)

      const emailResults = await Promise.allSettled(
        idsToFetch.map((messageId) => getEmailDetails(accessToken, messageId))
      )
      const rejected = emailResults.filter((r) => r.status === 'rejected')
      if (rejected.length > 0) {
        logger.warn(`[${requestId}] Failed to fetch ${rejected.length} email details`)
      }
      emails = emailResults
        .filter(
          (result): result is PromiseFulfilledResult<GmailEmail> => result.status === 'fulfilled'
        )
        .map((result) => result.value)

      emails = filterEmailsByLabels(emails, config)
    } else {
      return searchEmails(accessToken, config, requestId, logger)
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new emails:`, errorMessage)
    throw error
  }
}

function buildGmailSearchQuery(config: {
  labelIds?: string[]
  labelFilterBehavior?: 'INCLUDE' | 'EXCLUDE'
  searchQuery?: string
}): string {
  let labelQuery = ''
  if (config.labelIds && config.labelIds.length > 0) {
    const labelParts = config.labelIds.map((label) => `label:${label}`).join(' OR ')
    labelQuery =
      config.labelFilterBehavior === 'INCLUDE'
        ? config.labelIds.length > 1
          ? `(${labelParts})`
          : labelParts
        : config.labelIds.length > 1
          ? `-(${labelParts})`
          : `-${labelParts}`
  }

  let searchQueryPart = ''
  if (config.searchQuery?.trim()) {
    searchQueryPart = config.searchQuery.trim()
    if (searchQueryPart.includes(' OR ') || searchQueryPart.includes(' AND ')) {
      searchQueryPart = `(${searchQueryPart})`
    }
  }

  let baseQuery = ''
  if (labelQuery && searchQueryPart) {
    baseQuery = `${labelQuery} ${searchQueryPart}`
  } else if (searchQueryPart) {
    baseQuery = searchQueryPart
  } else if (labelQuery) {
    baseQuery = labelQuery
  } else {
    baseQuery = 'in:inbox'
  }

  return baseQuery
}

async function searchEmails(
  accessToken: string,
  config: GmailWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
) {
  try {
    const baseQuery = buildGmailSearchQuery(config)
    let timeConstraint = ''

    if (config.lastCheckedTimestamp) {
      const lastCheckedTime = new Date(config.lastCheckedTimestamp)
      const now = new Date()
      const minutesSinceLastCheck = (now.getTime() - lastCheckedTime.getTime()) / (60 * 1000)

      if (minutesSinceLastCheck < 60) {
        const bufferSeconds = Math.max(1 * 60 * 2, 180)
        const cutoffTime = new Date(lastCheckedTime.getTime() - bufferSeconds * 1000)
        const timestamp = Math.floor(cutoffTime.getTime() / 1000)
        timeConstraint = ` after:${timestamp}`
      } else if (minutesSinceLastCheck < 24 * 60) {
        const hours = Math.ceil(minutesSinceLastCheck / 60) + 1
        timeConstraint = ` newer_than:${hours}h`
      } else {
        const days = Math.min(Math.ceil(minutesSinceLastCheck / (24 * 60)), 7) + 1
        timeConstraint = ` newer_than:${days}d`
      }
    } else {
      timeConstraint = ' newer_than:1d'
    }

    const query = `${baseQuery}${timeConstraint}`
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${config.maxEmailsPerPoll || 25}`

    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!searchResponse.ok) {
      const errorData = await searchResponse.json()
      logger.error(`[${requestId}] Gmail search API error:`, {
        status: searchResponse.status,
        statusText: searchResponse.statusText,
        query,
        error: errorData,
      })
      throw new Error(
        `Gmail API error: ${searchResponse.status} ${searchResponse.statusText} - ${JSON.stringify(errorData)}`
      )
    }

    const searchData = await searchResponse.json()

    if (!searchData.messages || !searchData.messages.length) {
      logger.info(`[${requestId}] No emails found matching query: ${query}`)
      return { emails: [], latestHistoryId: config.historyId }
    }

    const idsToFetch = searchData.messages.slice(0, config.maxEmailsPerPoll || 25)
    let latestHistoryId = config.historyId

    logger.info(
      `[${requestId}] Processing ${idsToFetch.length} emails from search API (total matches: ${searchData.messages.length})`
    )

    const emailResults = await Promise.allSettled(
      idsToFetch.map((message: { id: string }) => getEmailDetails(accessToken, message.id))
    )
    const rejected = emailResults.filter((r) => r.status === 'rejected')
    if (rejected.length > 0) {
      logger.warn(`[${requestId}] Failed to fetch ${rejected.length} email details`)
    }
    const emails = emailResults
      .filter(
        (result): result is PromiseFulfilledResult<GmailEmail> => result.status === 'fulfilled'
      )
      .map((result) => result.value)

    if (emails.length > 0 && emails[0].historyId) {
      latestHistoryId = emails[0].historyId
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error searching emails:`, errorMessage)
    throw error
  }
}

async function getEmailDetails(accessToken: string, messageId: string): Promise<GmailEmail> {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`

  const messageResponse = await fetch(messageUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!messageResponse.ok) {
    const errorData = await messageResponse.json().catch(() => ({}))
    throw new Error(
      `Failed to fetch email details for message ${messageId}: ${messageResponse.status} ${messageResponse.statusText} - ${JSON.stringify(errorData)}`
    )
  }

  return await messageResponse.json()
}

function filterEmailsByLabels(emails: GmailEmail[], config: GmailWebhookConfig): GmailEmail[] {
  if (!config.labelIds.length) {
    return emails
  }

  return emails.filter((email) => {
    const emailLabels = email.labelIds || []
    const hasMatchingLabel = config.labelIds.some((configLabel) =>
      emailLabels.includes(configLabel)
    )
    return config.labelFilterBehavior === 'INCLUDE' ? hasMatchingLabel : !hasMatchingLabel
  })
}

async function processEmails(
  emails: GmailEmail[],
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  config: GmailWebhookConfig,
  accessToken: string,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
) {
  let processedCount = 0
  let failedCount = 0

  for (const email of emails) {
    try {
      await pollingIdempotency.executeWithIdempotency(
        'gmail',
        `${webhookData.id}:${email.id}`,
        async () => {
          const headers: Record<string, string> = {}
          const payload = email.payload as Record<string, unknown> | undefined
          if (payload?.headers && Array.isArray(payload.headers)) {
            for (const header of payload.headers as { name: string; value: string }[]) {
              headers[header.name.toLowerCase()] = header.value
            }
          }

          let textContent = ''
          let htmlContent = ''

          const extractContent = (part: Record<string, unknown>) => {
            if (!part) return

            if (part.mimeType === 'text/plain') {
              const body = part.body as { data?: string } | undefined
              if (body?.data) {
                textContent = Buffer.from(body.data, 'base64').toString('utf-8')
              }
            } else if (part.mimeType === 'text/html') {
              const body = part.body as { data?: string } | undefined
              if (body?.data) {
                htmlContent = Buffer.from(body.data, 'base64').toString('utf-8')
              }
            }

            if (part.parts && Array.isArray(part.parts)) {
              for (const subPart of part.parts) {
                extractContent(subPart as Record<string, unknown>)
              }
            }
          }

          if (payload) {
            extractContent(payload)
          }

          let date: string | null = null
          if (headers.date) {
            try {
              date = new Date(headers.date).toISOString()
            } catch (_e) {
              // Keep date as null if parsing fails
            }
          } else if (email.internalDate) {
            date = new Date(Number.parseInt(email.internalDate)).toISOString()
          }

          let attachments: GmailAttachment[] = []
          const hasAttachments = payload ? extractAttachmentInfo(payload).length > 0 : false

          if (config.includeAttachments && hasAttachments && payload) {
            try {
              const attachmentInfo = extractAttachmentInfo(payload)
              attachments = await downloadAttachments(email.id, attachmentInfo, accessToken)
            } catch (error) {
              logger.error(
                `[${requestId}] Error downloading attachments for email ${email.id}:`,
                error
              )
            }
          }

          const simplifiedEmail: SimplifiedEmail = {
            id: email.id,
            threadId: email.threadId,
            subject: headers.subject || '[No Subject]',
            from: headers.from || '',
            to: headers.to || '',
            cc: headers.cc || '',
            date,
            bodyText: textContent,
            bodyHtml: htmlContent,
            labels: email.labelIds || [],
            hasAttachments,
            attachments,
          }

          const webhookPayload: GmailWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
            ...(config.includeRawEmail ? { rawEmail: email } : {}),
          }

          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            webhookPayload,
            requestId
          )

          if (!result.success) {
            logger.error(
              `[${requestId}] Failed to process webhook for email ${email.id}:`,
              result.statusCode,
              result.error
            )
            throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
          }

          if (config.markAsRead) {
            await markEmailAsRead(accessToken, email.id, logger)
          }

          return { emailId: email.id, processed: true }
        }
      )

      logger.info(
        `[${requestId}] Successfully processed email ${email.id} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing email ${email.id}:`, errorMessage)
      failedCount++
    }
  }

  return { processedCount, failedCount }
}

async function markEmailAsRead(
  accessToken: string,
  messageId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
) {
  const modifyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`

  try {
    const response = await fetch(modifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(
        `Failed to mark email ${messageId} as read: ${response.status} ${response.statusText}`
      )
    }
  } catch (error) {
    logger.error(`Error marking email ${messageId} as read:`, error)
    throw error
  }
}
