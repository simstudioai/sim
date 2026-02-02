import { db } from '@sim/db'
import {
  account,
  credentialSet,
  webhook,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { isOrganizationOnTeamOrEnterprisePlan } from '@/lib/billing'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { GmailAttachment } from '@/tools/gmail/types'
import { downloadAttachments, extractAttachmentInfo } from '@/tools/gmail/utils'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('GmailPollingService')

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
  attachments: GmailAttachment[]
}

export interface GmailWebhookPayload {
  email: SimplifiedEmail
  timestamp: string
  rawEmail?: GmailEmail // Only included when includeRawEmail is true
}

async function markWebhookFailed(webhookId: string) {
  try {
    const result = await db
      .update(webhook)
      .set({
        failedCount: sql`COALESCE(${webhook.failedCount}, 0) + 1`,
        lastFailedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
      .returning({ failedCount: webhook.failedCount })

    const newFailedCount = result[0]?.failedCount || 0
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

    if (shouldDisable) {
      await db
        .update(webhook)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, webhookId))

      logger.warn(
        `Webhook ${webhookId} auto-disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as failed:`, err)
  }
}

async function markWebhookSuccess(webhookId: string) {
  try {
    await db
      .update(webhook)
      .set({
        failedCount: 0, // Reset on success
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as successful:`, err)
  }
}

export async function pollGmailWebhooks() {
  logger.info('Starting Gmail webhook polling')

  try {
    const activeWebhooksResult = await db
      .select({ webhook })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .leftJoin(
        workflowDeploymentVersion,
        and(
          eq(workflowDeploymentVersion.workflowId, workflow.id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .where(
        and(
          eq(webhook.provider, 'gmail'),
          eq(webhook.isActive, true),
          eq(workflow.isDeployed, true),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )

    const activeWebhooks = activeWebhooksResult.map((r) => r.webhook)

    if (!activeWebhooks.length) {
      logger.info('No active Gmail webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active Gmail webhooks`)

    // Limit the number of webhooks processed in parallel to avoid
    // exhausting Postgres or Gmail API connections when many users exist.
    const CONCURRENCY = 10

    const running: Promise<void>[] = []
    let successCount = 0
    let failureCount = 0

    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      const webhookId = webhookData.id
      const requestId = nanoid()

      try {
        const metadata = webhookData.providerConfig as any
        const credentialId: string | undefined = metadata?.credentialId
        const userId: string | undefined = metadata?.userId
        const credentialSetId: string | undefined = webhookData.credentialSetId ?? undefined

        if (!credentialId && !userId) {
          logger.error(`[${requestId}] Missing credential info for webhook ${webhookId}`)
          await markWebhookFailed(webhookId)
          failureCount++
          return
        }

        if (credentialSetId) {
          const [cs] = await db
            .select({ organizationId: credentialSet.organizationId })
            .from(credentialSet)
            .where(eq(credentialSet.id, credentialSetId))
            .limit(1)

          if (cs?.organizationId) {
            const hasAccess = await isOrganizationOnTeamOrEnterprisePlan(cs.organizationId)
            if (!hasAccess) {
              logger.error(
                `[${requestId}] Polling Group plan restriction: Your current plan does not support Polling Groups. Upgrade to Team or Enterprise to use this feature.`,
                {
                  webhookId,
                  credentialSetId,
                  organizationId: cs.organizationId,
                }
              )
              await markWebhookFailed(webhookId)
              failureCount++
              return
            }
          }
        }

        let accessToken: string | null = null

        if (credentialId) {
          const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
          if (rows.length === 0) {
            logger.error(
              `[${requestId}] Credential ${credentialId} not found for webhook ${webhookId}`
            )
            await markWebhookFailed(webhookId)
            failureCount++
            return
          }
          const ownerUserId = rows[0].userId
          accessToken = await refreshAccessTokenIfNeeded(credentialId, ownerUserId, requestId)
        } else if (userId) {
          // Legacy fallback for webhooks without credentialId
          accessToken = await getOAuthToken(userId, 'google-email')
        }

        if (!accessToken) {
          logger.error(`[${requestId}] Failed to get Gmail access token for webhook ${webhookId}`)
          await markWebhookFailed(webhookId)
          failureCount++
          return
        }

        const config = webhookData.providerConfig as unknown as GmailWebhookConfig

        const now = new Date()

        const fetchResult = await fetchNewEmails(accessToken, config, requestId)

        const { emails, latestHistoryId } = fetchResult

        if (!emails || !emails.length) {
          await updateWebhookLastChecked(
            webhookId,
            now.toISOString(),
            latestHistoryId || config.historyId
          )
          await markWebhookSuccess(webhookId)
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          successCount++
          return
        }

        logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)

        logger.info(`[${requestId}] Processing ${emails.length} emails for webhook ${webhookId}`)

        const emailsToProcess = emails

        const { processedCount, failedCount } = await processEmails(
          emailsToProcess,
          webhookData,
          config,
          accessToken,
          requestId
        )

        await updateWebhookLastChecked(
          webhookId,
          now.toISOString(),
          latestHistoryId || config.historyId
        )

        if (failedCount > 0 && processedCount === 0) {
          await markWebhookFailed(webhookId)
          failureCount++
          logger.warn(
            `[${requestId}] All ${failedCount} emails failed to process for webhook ${webhookId}`
          )
        } else {
          await markWebhookSuccess(webhookId)
          successCount++
          logger.info(
            `[${requestId}] Successfully processed ${processedCount} emails for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
          )
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing Gmail webhook ${webhookId}:`, error)
        await markWebhookFailed(webhookId)
        failureCount++
      }
    }

    for (const webhookData of activeWebhooks) {
      const promise: Promise<void> = enqueue(webhookData)
        .catch((err) => {
          logger.error('Unexpected error in webhook processing:', err)
          failureCount++
        })
        .finally(() => {
          const idx = running.indexOf(promise)
          if (idx !== -1) running.splice(idx, 1)
        })

      running.push(promise)

      if (running.length >= CONCURRENCY) {
        await Promise.race(running)
      }
    }

    await Promise.allSettled(running)

    const summary = {
      total: activeWebhooks.length,
      successful: successCount,
      failed: failureCount,
      details: [],
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
    const useHistoryApi = !!config.historyId
    let emails = []
    let latestHistoryId = config.historyId

    if (useHistoryApi) {
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

      const emailPromises = idsToFetch.map(async (messageId) => {
        return getEmailDetails(accessToken, messageId)
      })

      const emailResults = await Promise.allSettled(emailPromises)
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
      const searchResult = await searchEmails(accessToken, config, requestId)
      return searchResult
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new emails:`, errorMessage)
    throw error
  }
}

/**
 * Builds a Gmail search query from label and search configuration
 */
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

async function searchEmails(accessToken: string, config: GmailWebhookConfig, requestId: string) {
  try {
    const baseQuery = buildGmailSearchQuery(config)
    logger.debug(`[${requestId}] Gmail search query: ${baseQuery}`)

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
        logger.debug(`[${requestId}] Using timestamp-based query with ${bufferSeconds}s buffer`)
      } else if (minutesSinceLastCheck < 24 * 60) {
        const hours = Math.ceil(minutesSinceLastCheck / 60) + 1 // Round up and add 1 hour buffer
        timeConstraint = ` newer_than:${hours}h`
        logger.debug(`[${requestId}] Using hour-based query: newer_than:${hours}h`)
      } else {
        const days = Math.min(Math.ceil(minutesSinceLastCheck / (24 * 60)), 7) + 1
        timeConstraint = ` newer_than:${days}d`
        logger.debug(`[${requestId}] Using day-based query: newer_than:${days}d`)
      }
    } else {
      timeConstraint = ' newer_than:1d'
      logger.debug(`[${requestId}] No last check time, using default: newer_than:1d`)
    }

    const query = `${baseQuery}${timeConstraint}`

    logger.info(`[${requestId}] Searching for emails with query: ${query}`)

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

    const emailPromises = idsToFetch.map(async (message: { id: string }) => {
      return getEmailDetails(accessToken, message.id)
    })

    const emailResults = await Promise.allSettled(emailPromises)
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
      logger.debug(`[${requestId}] Updated historyId to ${latestHistoryId}`)
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
  let failedCount = 0

  for (const email of emails) {
    try {
      await pollingIdempotency.executeWithIdempotency(
        'gmail',
        `${webhookData.id}:${email.id}`,
        async () => {
          const headers: Record<string, string> = {}
          if (email.payload?.headers) {
            for (const header of email.payload.headers) {
              headers[header.name.toLowerCase()] = header.value
            }
          }

          let textContent = ''
          let htmlContent = ''

          const extractContent = (part: any) => {
            if (!part) return

            if (part.mimeType === 'text/plain' && part.body?.data) {
              textContent = Buffer.from(part.body.data, 'base64').toString('utf-8')
            } else if (part.mimeType === 'text/html' && part.body?.data) {
              htmlContent = Buffer.from(part.body.data, 'base64').toString('utf-8')
            }

            if (part.parts && Array.isArray(part.parts)) {
              for (const subPart of part.parts) {
                extractContent(subPart)
              }
            }
          }

          if (email.payload) {
            extractContent(email.payload)
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
          const hasAttachments = email.payload
            ? extractAttachmentInfo(email.payload).length > 0
            : false

          if (config.includeAttachments && hasAttachments && email.payload) {
            try {
              const attachmentInfo = extractAttachmentInfo(email.payload)
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
            date: date,
            bodyText: textContent,
            bodyHtml: htmlContent,
            labels: email.labelIds || [],
            hasAttachments,
            attachments,
          }

          const payload: GmailWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
            ...(config.includeRawEmail ? { rawEmail: email } : {}),
          }

          logger.debug(
            `[${requestId}] Sending ${config.includeRawEmail ? 'simplified + raw' : 'simplified'} email payload for ${email.id}`
          )

          const webhookUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhookData.path}`

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Sim/1.0',
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
      failedCount++
    }
  }

  return { processedCount, failedCount }
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
  try {
    const result = await db.select().from(webhook).where(eq(webhook.id, webhookId))
    const existingConfig = (result[0]?.providerConfig as Record<string, any>) || {}
    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...existingConfig,
          lastCheckedTimestamp: timestamp,
          ...(historyId ? { historyId } : {}),
        } as any,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (error) {
    logger.error(`Error updating webhook ${webhookId} last checked timestamp:`, error)
  }
}
