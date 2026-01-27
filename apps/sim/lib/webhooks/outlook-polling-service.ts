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
import { htmlToText } from 'html-to-text'
import { nanoid } from 'nanoid'
import { isOrganizationOnTeamOrEnterprisePlan } from '@/lib/billing'
import { pollingIdempotency } from '@/lib/core/idempotency'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('OutlookPollingService')

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

interface OutlookWebhookConfig {
  credentialId: string
  folderIds?: string[] // e.g., ['inbox', 'sent']
  folderFilterBehavior?: 'INCLUDE' | 'EXCLUDE'
  markAsRead?: boolean
  maxEmailsPerPoll?: number
  lastCheckedTimestamp?: string
  includeAttachments?: boolean
  includeRawEmail?: boolean
}

interface OutlookEmail {
  id: string
  conversationId: string
  subject: string
  bodyPreview: string
  body: {
    contentType: string
    content: string
  }
  from: {
    emailAddress: {
      name: string
      address: string
    }
  }
  toRecipients: Array<{
    emailAddress: {
      name: string
      address: string
    }
  }>
  ccRecipients?: Array<{
    emailAddress: {
      name: string
      address: string
    }
  }>
  receivedDateTime: string
  sentDateTime: string
  hasAttachments: boolean
  isRead: boolean
  parentFolderId: string
}

export interface OutlookAttachment {
  name: string
  data: Buffer
  contentType: string
  size: number
}

export interface SimplifiedOutlookEmail {
  id: string
  conversationId: string
  subject: string
  from: string
  to: string
  cc: string
  date: string
  bodyText: string
  bodyHtml: string
  hasAttachments: boolean
  attachments: OutlookAttachment[]
  isRead: boolean
  folderId: string
  messageId: string
  threadId: string
}

export interface OutlookWebhookPayload {
  email: SimplifiedOutlookEmail
  timestamp: string
  rawEmail?: OutlookEmail
}

/**
 * Convert HTML content to a readable plain-text representation.
 * Keeps reasonable newlines and decodes common HTML entities.
 */
function convertHtmlToPlainText(html: string): string {
  if (!html) return ''
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, noAnchorUrl: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
    preserveNewlines: true,
  })
}

export async function pollOutlookWebhooks() {
  logger.info('Starting Outlook webhook polling')

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
          eq(webhook.provider, 'outlook'),
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
      logger.info('No active Outlook webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active Outlook webhooks`)

    const CONCURRENCY = 10
    const running: Promise<void>[] = []
    let successCount = 0
    let failureCount = 0

    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      const webhookId = webhookData.id
      const requestId = nanoid()

      try {
        logger.info(`[${requestId}] Processing Outlook webhook: ${webhookId}`)

        const metadata = webhookData.providerConfig as any
        const credentialId: string | undefined = metadata?.credentialId
        const userId: string | undefined = metadata?.userId
        const credentialSetId: string | undefined = webhookData.credentialSetId ?? undefined

        if (!credentialId && !userId) {
          logger.error(`[${requestId}] Missing credentialId and userId for webhook ${webhookId}`)
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
          if (!rows.length) {
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
          accessToken = await getOAuthToken(userId, 'outlook')
        }

        if (!accessToken) {
          logger.error(
            `[${requestId}] Failed to get Outlook access token for webhook ${webhookId} (cred or fallback)`
          )
          await markWebhookFailed(webhookId)
          failureCount++
          return
        }

        const config = webhookData.providerConfig as unknown as OutlookWebhookConfig

        const now = new Date()

        const fetchResult = await fetchNewOutlookEmails(accessToken, config, requestId)
        const { emails } = fetchResult

        if (!emails || !emails.length) {
          await updateWebhookLastChecked(webhookId, now.toISOString())
          await markWebhookSuccess(webhookId)
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          successCount++
          return
        }

        logger.info(`[${requestId}] Found ${emails.length} emails for webhook ${webhookId}`)

        logger.info(`[${requestId}] Processing ${emails.length} emails for webhook ${webhookId}`)

        const { processedCount, failedCount } = await processOutlookEmails(
          emails,
          webhookData,
          config,
          accessToken,
          requestId
        )

        await updateWebhookLastChecked(webhookId, now.toISOString())

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
        logger.error(`[${requestId}] Error processing Outlook webhook ${webhookId}:`, error)
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

    logger.info(`Outlook polling completed: ${successCount} successful, ${failureCount} failed`)

    return {
      total: activeWebhooks.length,
      successful: successCount,
      failed: failureCount,
      details: [],
    }
  } catch (error) {
    logger.error('Error during Outlook webhook polling:', error)
    throw error
  }
}

async function fetchNewOutlookEmails(
  accessToken: string,
  config: OutlookWebhookConfig,
  requestId: string
) {
  try {
    const apiUrl = 'https://graph.microsoft.com/v1.0/me/messages'
    const params = new URLSearchParams()

    params.append(
      '$select',
      'id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isRead,parentFolderId'
    )

    params.append('$orderby', 'receivedDateTime desc')

    params.append('$top', (config.maxEmailsPerPoll || 25).toString())

    if (config.lastCheckedTimestamp) {
      const lastChecked = new Date(config.lastCheckedTimestamp)
      const bufferTime = new Date(lastChecked.getTime() - 60000)
      params.append('$filter', `receivedDateTime gt ${bufferTime.toISOString()}`)
    }

    const fullUrl = `${apiUrl}?${params.toString()}`

    logger.info(`[${requestId}] Fetching emails from: ${fullUrl}`)

    const response = await fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      })
      throw new Error(
        `Microsoft Graph API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
      )
    }

    const data = await response.json()
    const emails = data.value || []

    let resolvedFolderIds: Map<string, string> | undefined
    if (config.folderIds && config.folderIds.length > 0) {
      const hasWellKnownFolders = config.folderIds.some(isWellKnownFolderName)
      if (hasWellKnownFolders) {
        resolvedFolderIds = await resolveWellKnownFolderIds(
          accessToken,
          config.folderIds,
          requestId
        )
      }
    }

    const filteredEmails = filterEmailsByFolder(emails, config, resolvedFolderIds)

    logger.info(
      `[${requestId}] Fetched ${emails.length} emails, ${filteredEmails.length} after filtering`
    )

    return { emails: filteredEmails }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new Outlook emails:`, errorMessage)
    throw error
  }
}

const OUTLOOK_WELL_KNOWN_FOLDERS = new Set([
  'inbox',
  'drafts',
  'sentitems',
  'deleteditems',
  'junkemail',
  'archive',
  'outbox',
])

function isWellKnownFolderName(folderId: string): boolean {
  return OUTLOOK_WELL_KNOWN_FOLDERS.has(folderId.toLowerCase())
}

async function resolveWellKnownFolderId(
  accessToken: string,
  folderName: string,
  requestId: string
): Promise<string | null> {
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${folderName}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      logger.warn(
        `[${requestId}] Failed to resolve well-known folder '${folderName}': ${response.status}`
      )
      return null
    }

    const folder = await response.json()
    return folder.id || null
  } catch (error) {
    logger.error(`[${requestId}] Error resolving well-known folder '${folderName}':`, error)
    return null
  }
}

async function resolveWellKnownFolderIds(
  accessToken: string,
  folderIds: string[],
  requestId: string
): Promise<Map<string, string>> {
  const resolvedIds = new Map<string, string>()

  const wellKnownFolders = folderIds.filter(isWellKnownFolderName)
  if (wellKnownFolders.length === 0) {
    return resolvedIds
  }

  const resolutions = await Promise.all(
    wellKnownFolders.map(async (folderName) => {
      const actualId = await resolveWellKnownFolderId(accessToken, folderName, requestId)
      return { folderName, actualId }
    })
  )

  for (const { folderName, actualId } of resolutions) {
    if (actualId) {
      resolvedIds.set(folderName.toLowerCase(), actualId)
    }
  }

  logger.info(
    `[${requestId}] Resolved ${resolvedIds.size}/${wellKnownFolders.length} well-known folders`
  )

  return resolvedIds
}

function filterEmailsByFolder(
  emails: OutlookEmail[],
  config: OutlookWebhookConfig,
  resolvedFolderIds?: Map<string, string>
): OutlookEmail[] {
  if (!config.folderIds || !config.folderIds.length) {
    return emails
  }

  const actualFolderIds = config.folderIds.map((configFolder) => {
    if (resolvedFolderIds && isWellKnownFolderName(configFolder)) {
      const resolvedId = resolvedFolderIds.get(configFolder.toLowerCase())
      if (resolvedId) {
        return resolvedId
      }
    }
    return configFolder
  })

  return emails.filter((email) => {
    const emailFolderId = email.parentFolderId
    const hasMatchingFolder = actualFolderIds.some(
      (folderId) => emailFolderId.toLowerCase() === folderId.toLowerCase()
    )

    return config.folderFilterBehavior === 'INCLUDE' ? hasMatchingFolder : !hasMatchingFolder
  })
}

async function processOutlookEmails(
  emails: OutlookEmail[],
  webhookData: any,
  config: OutlookWebhookConfig,
  accessToken: string,
  requestId: string
) {
  let processedCount = 0
  let failedCount = 0

  for (const email of emails) {
    try {
      await pollingIdempotency.executeWithIdempotency(
        'outlook',
        `${webhookData.id}:${email.id}`,
        async () => {
          let attachments: OutlookAttachment[] = []
          if (config.includeAttachments && email.hasAttachments) {
            try {
              attachments = await downloadOutlookAttachments(accessToken, email.id, requestId)
            } catch (error) {
              logger.error(
                `[${requestId}] Error downloading attachments for email ${email.id}:`,
                error
              )
            }
          }

          const simplifiedEmail: SimplifiedOutlookEmail = {
            id: email.id,
            conversationId: email.conversationId,
            subject: email.subject || '',
            from: email.from?.emailAddress?.address || '',
            to: email.toRecipients?.map((r) => r.emailAddress.address).join(', ') || '',
            cc: email.ccRecipients?.map((r) => r.emailAddress.address).join(', ') || '',
            date: email.receivedDateTime,
            bodyText: (() => {
              const content = email.body?.content || ''
              const type = (email.body?.contentType || '').toLowerCase()
              if (!content) {
                return email.bodyPreview || ''
              }
              if (type === 'text' || type === 'text/plain') {
                return content
              }
              return convertHtmlToPlainText(content)
            })(),
            bodyHtml: email.body?.content || '',
            hasAttachments: email.hasAttachments,
            attachments,
            isRead: email.isRead,
            folderId: email.parentFolderId,
            messageId: email.id,
            threadId: email.conversationId,
          }

          const payload: OutlookWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
          }

          if (config.includeRawEmail) {
            payload.rawEmail = email
          }

          logger.info(
            `[${requestId}] Processing email: ${email.subject} from ${email.from?.emailAddress?.address}`
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
            await markOutlookEmailAsRead(accessToken, email.id)
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
      logger.error(`[${requestId}] Error processing email ${email.id}:`, error)
      failedCount++
    }
  }

  return { processedCount, failedCount }
}

async function downloadOutlookAttachments(
  accessToken: string,
  messageId: string,
  requestId: string
): Promise<OutlookAttachment[]> {
  const attachments: OutlookAttachment[] = []

  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      logger.error(`[${requestId}] Failed to fetch attachments for message ${messageId}`)
      return attachments
    }

    const data = await response.json()
    const attachmentsList = data.value || []

    for (const attachment of attachmentsList) {
      try {
        if (attachment['@odata.type'] === '#microsoft.graph.fileAttachment') {
          const contentBytes = attachment.contentBytes
          if (contentBytes) {
            const buffer = Buffer.from(contentBytes, 'base64')
            attachments.push({
              name: attachment.name,
              data: buffer,
              contentType: attachment.contentType,
              size: attachment.size,
            })
          }
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Error processing attachment ${attachment.id} for message ${messageId}:`,
          error
        )
      }
    }

    logger.info(
      `[${requestId}] Downloaded ${attachments.length} attachments for message ${messageId}`
    )
  } catch (error) {
    logger.error(`[${requestId}] Error downloading attachments for message ${messageId}:`, error)
  }

  return attachments
}

async function markOutlookEmailAsRead(accessToken: string, messageId: string) {
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isRead: true,
      }),
    })

    if (!response.ok) {
      logger.error(
        `Failed to mark email ${messageId} as read:`,
        response.status,
        await response.text()
      )
    }
  } catch (error) {
    logger.error(`Error marking email ${messageId} as read:`, error)
  }
}

async function updateWebhookLastChecked(webhookId: string, timestamp: string) {
  try {
    const currentWebhook = await db
      .select({ providerConfig: webhook.providerConfig })
      .from(webhook)
      .where(eq(webhook.id, webhookId))
      .limit(1)

    if (!currentWebhook.length) {
      logger.error(`Webhook ${webhookId} not found`)
      return
    }

    const currentConfig = (currentWebhook[0].providerConfig as any) || {}
    const updatedConfig = {
      ...currentConfig,
      lastCheckedTimestamp: timestamp,
    }

    await db
      .update(webhook)
      .set({
        providerConfig: updatedConfig,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (error) {
    logger.error(`Error updating webhook ${webhookId} last checked timestamp:`, error)
  }
}
