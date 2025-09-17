import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { pollingIdempotency } from '@/lib/idempotency/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GmailPollingService')

interface GmailWebhookConfig {
  labelIds: string[]
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE'
  markAsRead: boolean
  maxEmailsPerPoll?: number
  lastCheckedTimestamp?: string
  historyId?: string
  pollingInterval?: number
  includeRawEmail?: boolean
}

interface GmailEmail {
  id: string
  threadId: string
  historyId?: string
  labelIds?: string[]
  payload?: any
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
  attachments: Array<{ filename: string; mimeType: string; size: number }>
}

export interface GmailWebhookPayload {
  email: SimplifiedEmail
  timestamp: string
  rawEmail?: GmailEmail // Only included when includeRawEmail is true
}

export async function pollGmailWebhooks() {
  logger.info('Starting Gmail webhook polling')

  try {
    // Get all active Gmail webhooks
    const activeWebhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'gmail'), eq(webhook.isActive, true)))

    if (!activeWebhooks.length) {
      logger.info('No active Gmail webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active Gmail webhooks`)

    // Limit the number of webhooks processed in parallel to avoid
    // exhausting Postgres or Gmail API connections when many users exist.
    const CONCURRENCY = 10

    const running: Promise<any>[] = []
    const settledResults: PromiseSettledResult<any>[] = []

    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      const webhookId = webhookData.id
      const requestId = nanoid()

      try {
        // Extract metadata
        const metadata = webhookData.providerConfig as any
        const credentialId: string | undefined = metadata?.credentialId
        const userId: string | undefined = metadata?.userId

        if (!credentialId && !userId) {
          logger.error(`[${requestId}] Missing credentialId and userId for webhook ${webhookId}`)
          return { success: false, webhookId, error: 'Missing credentialId and userId' }
        }

        // Resolve owner and token
        let accessToken: string | null = null
        if (credentialId) {
          const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
          if (rows.length === 0) {
            logger.error(
              `[${requestId}] Credential ${credentialId} not found for webhook ${webhookId}`
            )
            return { success: false, webhookId, error: 'Credential not found' }
          }
          const ownerUserId = rows[0].userId
          accessToken = await refreshAccessTokenIfNeeded(credentialId, ownerUserId, requestId)
        } else if (userId) {
          // Backward-compat fallback to workflow owner token
          accessToken = await getOAuthToken(userId, 'google-email')
        }

        if (!accessToken) {
          logger.error(
            `[${requestId}] Failed to get Gmail access token for webhook ${webhookId} (cred or fallback)`
          )
          return { success: false, webhookId, error: 'No access token' }
        }

        // Get webhook configuration
        const config = webhookData.providerConfig as unknown as GmailWebhookConfig

        const now = new Date()

        // Fetch new emails
        const fetchResult = await fetchNewEmails(accessToken, config, requestId)

        const { emails, latestHistoryId } = fetchResult

        if (!emails || !emails.length) {
          // Update last checked timestamp
          await updateWebhookLastChecked(
            webhookId,
            now.toISOString(),
            latestHistoryId || config.historyId
          )
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          return { success: true, webhookId, status: 'no_emails' }
        }

        logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)

        logger.info(`[${requestId}] Processing ${emails.length} emails for webhook ${webhookId}`)

        // Process all emails (process each email as a separate workflow trigger)
        const emailsToProcess = emails

        // Process emails
        const processed = await processEmails(
          emailsToProcess,
          webhookData,
          config,
          accessToken,
          requestId
        )

        // Update webhook with latest history ID and timestamp
        await updateWebhookData(webhookId, now.toISOString(), latestHistoryId || config.historyId)

        return {
          success: true,
          webhookId,
          emailsFound: emails.length,
          emailsProcessed: processed,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(`[${requestId}] Error processing Gmail webhook ${webhookId}:`, error)
        return { success: false, webhookId, error: errorMessage }
      }
    }

    for (const webhookData of activeWebhooks) {
      running.push(enqueue(webhookData))

      if (running.length >= CONCURRENCY) {
        const result = await Promise.race(running)
        running.splice(running.indexOf(result), 1)
        settledResults.push(result)
      }
    }

    while (running.length) {
      const result = await Promise.race(running)
      running.splice(running.indexOf(result), 1)
      settledResults.push(result)
    }

    const results = settledResults

    const summary = {
      total: results.length,
      successful: results.filter((r) => r.status === 'fulfilled' && r.value.success).length,
      failed: results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      ).length,
      details: results.map((r) =>
        r.status === 'fulfilled' ? r.value : { success: false, error: r.reason }
      ),
    }

    logger.info('Gmail polling completed', {
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
    })

    return summary
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error in Gmail polling service:', errorMessage)
    throw error
  }
}

async function fetchNewEmails(accessToken: string, config: GmailWebhookConfig, requestId: string) {
  try {
    // Determine whether to use history API or search
    const useHistoryApi = !!config.historyId
    let emails = []
    let latestHistoryId = config.historyId

    if (useHistoryApi) {
      // Use history API to get changes since last check
      const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${config.historyId}`

      const historyResponse = await fetch(historyUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!historyResponse.ok) {
        const errorData = await historyResponse.json()
        logger.error(`[${requestId}] Gmail history API error:`, {
          status: historyResponse.status,
          statusText: historyResponse.statusText,
          error: errorData,
        })

        // Fall back to search if history API fails
        logger.info(`[${requestId}] Falling back to search API after history API failure`)
        const searchResult = await searchEmails(accessToken, config, requestId)
        return {
          emails: searchResult.emails,
          latestHistoryId: searchResult.latestHistoryId,
        }
      }

      const historyData = await historyResponse.json()

      if (!historyData.history || !historyData.history.length) {
        return { emails: [], latestHistoryId }
      }

      // Update the latest history ID
      if (historyData.historyId) {
        latestHistoryId = historyData.historyId
      }

      // Extract message IDs from history
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

      // Sort IDs by recency (reverse order)
      const sortedIds = [...messageIds].sort().reverse()

      // Process all emails but respect the configured limit
      const idsToFetch = sortedIds.slice(0, config.maxEmailsPerPoll || 25)
      logger.info(`[${requestId}] Processing ${idsToFetch.length} emails from history API`)

      // Fetch full email details for each message
      const emailPromises = idsToFetch.map(async (messageId) => {
        return getEmailDetails(accessToken, messageId)
      })

      const emailResults = await Promise.allSettled(emailPromises)
      emails = emailResults
        .filter(
          (result): result is PromiseFulfilledResult<GmailEmail> => result.status === 'fulfilled'
        )
        .map((result) => result.value)

      // Filter emails by labels if needed
      emails = filterEmailsByLabels(emails, config)
    } else {
      // Use search if no history ID is available
      const searchResult = await searchEmails(accessToken, config, requestId)
      return searchResult
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new emails:`, errorMessage)
    return { emails: [], latestHistoryId: config.historyId }
  }
}

async function searchEmails(accessToken: string, config: GmailWebhookConfig, requestId: string) {
  try {
    // Build query parameters for label filtering
    const labelQuery =
      config.labelIds && config.labelIds.length > 0
        ? config.labelIds.map((label) => `label:${label}`).join(' ')
        : 'in:inbox'

    // Improved time-based filtering with dynamic buffer
    let timeConstraint = ''

    if (config.lastCheckedTimestamp) {
      // Parse the last check time
      const lastCheckedTime = new Date(config.lastCheckedTimestamp)
      const now = new Date()

      // Calculate minutes since last check
      const minutesSinceLastCheck = (now.getTime() - lastCheckedTime.getTime()) / (60 * 1000)

      // If last check was recent, use precise time-based query
      if (minutesSinceLastCheck < 60) {
        // Less than an hour ago
        // Calculate buffer in seconds - the greater of:
        // 1. Twice the configured polling interval (or 2 minutes if not set)
        // 2. At least 3 minutes (180 seconds)
        const bufferSeconds = Math.max((config.pollingInterval || 2) * 60 * 2, 180)

        // Calculate the cutoff time with buffer
        const cutoffTime = new Date(lastCheckedTime.getTime() - bufferSeconds * 1000)

        // Format for Gmail's search syntax (seconds since epoch)
        const timestamp = Math.floor(cutoffTime.getTime() / 1000)

        timeConstraint = ` after:${timestamp}`
        logger.debug(`[${requestId}] Using timestamp-based query with ${bufferSeconds}s buffer`)
      }
      // If last check was a while ago, use Gmail's relative time queries
      else if (minutesSinceLastCheck < 24 * 60) {
        // Less than a day
        // Use newer_than:Xh syntax for better reliability with longer intervals
        const hours = Math.ceil(minutesSinceLastCheck / 60) + 1 // Round up and add 1 hour buffer
        timeConstraint = ` newer_than:${hours}h`
        logger.debug(`[${requestId}] Using hour-based query: newer_than:${hours}h`)
      } else {
        // For very old last checks, limit to a reasonable time period (7 days max)
        const days = Math.min(Math.ceil(minutesSinceLastCheck / (24 * 60)), 7) + 1
        timeConstraint = ` newer_than:${days}d`
        logger.debug(`[${requestId}] Using day-based query: newer_than:${days}d`)
      }
    } else {
      // If there's no last checked timestamp, default to recent emails (last 24h)
      timeConstraint = ' newer_than:1d'
      logger.debug(`[${requestId}] No last check time, using default: newer_than:1d`)
    }

    // Combine label and time constraints
    const query =
      config.labelFilterBehavior === 'INCLUDE'
        ? `${labelQuery}${timeConstraint}`
        : `-${labelQuery}${timeConstraint}`

    logger.info(`[${requestId}] Searching for emails with query: ${query}`)

    // Search for emails with lower default
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${config.maxEmailsPerPoll || 25}`

    const searchResponse = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!searchResponse.ok) {
      const errorData = await searchResponse.json()
      logger.error(`[${requestId}] Gmail search API error:`, {
        status: searchResponse.status,
        statusText: searchResponse.statusText,
        query: query,
        error: errorData,
      })
      return { emails: [], latestHistoryId: config.historyId }
    }

    const searchData = await searchResponse.json()

    if (!searchData.messages || !searchData.messages.length) {
      logger.info(`[${requestId}] No emails found matching query: ${query}`)
      return { emails: [], latestHistoryId: config.historyId }
    }

    // Process emails within the limit
    const idsToFetch = searchData.messages.slice(0, config.maxEmailsPerPoll || 25)
    let latestHistoryId = config.historyId

    logger.info(
      `[${requestId}] Processing ${idsToFetch.length} emails from search API (total matches: ${searchData.messages.length})`
    )

    // Fetch full email details for each message
    const emailPromises = idsToFetch.map(async (message: { id: string }) => {
      return getEmailDetails(accessToken, message.id)
    })

    const emailResults = await Promise.allSettled(emailPromises)
    const emails = emailResults
      .filter(
        (result): result is PromiseFulfilledResult<GmailEmail> => result.status === 'fulfilled'
      )
      .map((result) => result.value)

    // Get the latest history ID from the first email (most recent)
    if (emails.length > 0 && emails[0].historyId) {
      latestHistoryId = emails[0].historyId
      logger.debug(`[${requestId}] Updated historyId to ${latestHistoryId}`)
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error searching emails:`, errorMessage)
    return { emails: [], latestHistoryId: config.historyId }
  }
}

async function getEmailDetails(accessToken: string, messageId: string): Promise<GmailEmail> {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`

  const messageResponse = await fetch(messageUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
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

    return config.labelFilterBehavior === 'INCLUDE'
      ? hasMatchingLabel // Include emails with matching labels
      : !hasMatchingLabel // Exclude emails with matching labels
  })
}

async function processEmails(
  emails: any[],
  webhookData: any,
  config: GmailWebhookConfig,
  accessToken: string,
  requestId: string
) {
  let processedCount = 0

  for (const email of emails) {
    try {
      const result = await pollingIdempotency.executeWithIdempotency(
        'gmail',
        `${webhookData.id}:${email.id}`,
        async () => {
          // Extract useful information from email to create a simplified payload
          // First, extract headers into a map for easy access
          const headers: Record<string, string> = {}
          if (email.payload?.headers) {
            for (const header of email.payload.headers) {
              headers[header.name.toLowerCase()] = header.value
            }
          }

          // Extract and decode email body content
          let textContent = ''
          let htmlContent = ''

          // Function to extract content from parts recursively
          const extractContent = (part: any) => {
            if (!part) return

            // Extract current part content if it exists
            if (part.mimeType === 'text/plain' && part.body?.data) {
              textContent = Buffer.from(part.body.data, 'base64').toString('utf-8')
            } else if (part.mimeType === 'text/html' && part.body?.data) {
              htmlContent = Buffer.from(part.body.data, 'base64').toString('utf-8')
            }

            // Process nested parts
            if (part.parts && Array.isArray(part.parts)) {
              for (const subPart of part.parts) {
                extractContent(subPart)
              }
            }
          }

          // Extract content from the email payload
          if (email.payload) {
            extractContent(email.payload)
          }

          // Parse date into standard format
          let date: string | null = null
          if (headers.date) {
            try {
              date = new Date(headers.date).toISOString()
            } catch (_e) {
              // Keep date as null if parsing fails
            }
          } else if (email.internalDate) {
            // Use internalDate as fallback (convert from timestamp to ISO string)
            date = new Date(Number.parseInt(email.internalDate)).toISOString()
          }

          // Extract attachment information if present
          const attachments: Array<{ filename: string; mimeType: string; size: number }> = []

          const findAttachments = (part: any) => {
            if (!part) return

            if (part.filename && part.filename.length > 0) {
              attachments.push({
                filename: part.filename,
                mimeType: part.mimeType || 'application/octet-stream',
                size: part.body?.size || 0,
              })
            }

            // Look for attachments in nested parts
            if (part.parts && Array.isArray(part.parts)) {
              for (const subPart of part.parts) {
                findAttachments(subPart)
              }
            }
          }

          if (email.payload) {
            findAttachments(email.payload)
          }

          // Create simplified email object
          const simplifiedEmail: SimplifiedEmail = {
            id: email.id,
            threadId: email.threadId,
            subject: headers.subject || '[No Subject]',
            from: headers.from || '',
            to: headers.to || '',
            cc: headers.cc || '',
            date: date,
            bodyText: textContent,
            bodyHtml: htmlContent,
            labels: email.labelIds || [],
            hasAttachments: attachments.length > 0,
            attachments: attachments,
          }

          // Prepare webhook payload with simplified email and optionally raw email
          const payload: GmailWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
            ...(config.includeRawEmail ? { rawEmail: email } : {}),
          }

          logger.debug(
            `[${requestId}] Sending ${config.includeRawEmail ? 'simplified + raw' : 'simplified'} email payload for ${email.id}`
          )

          // Trigger the webhook
          const webhookUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhookData.path}`

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Secret': webhookData.secret || '',
              'User-Agent': 'SimStudio/1.0',
            },
            body: JSON.stringify(payload),
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.error(
              `[${requestId}] Failed to trigger webhook for email ${email.id}:`,
              response.status,
              errorText
            )
            throw new Error(`Webhook request failed: ${response.status} - ${errorText}`)
          }

          // Mark email as read if configured
          if (config.markAsRead) {
            await markEmailAsRead(accessToken, email.id)
          }

          return {
            emailId: email.id,
            webhookStatus: response.status,
            processed: true,
          }
        }
      )

      logger.info(
        `[${requestId}] Successfully processed email ${email.id} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing email ${email.id}:`, errorMessage)
      // Continue processing other emails even if one fails
    }
  }

  return processedCount
}

async function markEmailAsRead(accessToken: string, messageId: string) {
  const modifyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`

  try {
    const response = await fetch(modifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        removeLabelIds: ['UNREAD'],
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to mark email ${messageId} as read: ${response.status} ${response.statusText}`
      )
    }
  } catch (error) {
    logger.error(`Error marking email ${messageId} as read:`, error)
    throw error
  }
}

async function updateWebhookLastChecked(webhookId: string, timestamp: string, historyId?: string) {
  const existingConfig =
    (await db.select().from(webhook).where(eq(webhook.id, webhookId)))[0]?.providerConfig || {}
  await db
    .update(webhook)
    .set({
      providerConfig: {
        ...existingConfig,
        lastCheckedTimestamp: timestamp,
        ...(historyId ? { historyId } : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(webhook.id, webhookId))
}

async function updateWebhookData(webhookId: string, timestamp: string, historyId?: string) {
  const existingConfig =
    (await db.select().from(webhook).where(eq(webhook.id, webhookId)))[0]?.providerConfig || {}

  await db
    .update(webhook)
    .set({
      providerConfig: {
        ...existingConfig,
        lastCheckedTimestamp: timestamp,
        ...(historyId ? { historyId } : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(webhook.id, webhookId))
}
