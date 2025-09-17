import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { htmlToText } from 'html-to-text'
import { nanoid } from 'nanoid'
import { pollingIdempotency } from '@/lib/idempotency'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('OutlookPollingService')

interface OutlookWebhookConfig {
  credentialId: string
  folderIds?: string[] // e.g., ['inbox', 'sent']
  folderFilterBehavior?: 'INCLUDE' | 'EXCLUDE'
  markAsRead?: boolean
  maxEmailsPerPoll?: number
  lastCheckedTimestamp?: string
  pollingInterval?: number
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
  isRead: boolean
  folderId: string
  // Thread support fields
  messageId: string // Same as id, but explicit for threading
  threadId: string // Same as conversationId, but explicit for threading
}

export interface OutlookWebhookPayload {
  email: SimplifiedOutlookEmail
  timestamp: string
  rawEmail?: OutlookEmail // Only included when includeRawEmail is true
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
    // Get all active Outlook webhooks
    const activeWebhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'outlook'), eq(webhook.isActive, true)))

    if (!activeWebhooks.length) {
      logger.info('No active Outlook webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active Outlook webhooks`)

    // Limit concurrency to avoid exhausting connections
    const CONCURRENCY = 10
    const running: Promise<any>[] = []
    const results: any[] = []

    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      const webhookId = webhookData.id
      const requestId = nanoid()

      try {
        logger.info(`[${requestId}] Processing Outlook webhook: ${webhookId}`)

        // Extract credentialId and/or userId
        const metadata = webhookData.providerConfig as any
        const credentialId: string | undefined = metadata?.credentialId
        const userId: string | undefined = metadata?.userId

        if (!credentialId && !userId) {
          logger.error(`[${requestId}] Missing credentialId and userId for webhook ${webhookId}`)
          return { success: false, webhookId, error: 'Missing credentialId and userId' }
        }

        // Resolve access token
        let accessToken: string | null = null
        if (credentialId) {
          const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
          if (!rows.length) {
            logger.error(
              `[${requestId}] Credential ${credentialId} not found for webhook ${webhookId}`
            )
            return { success: false, webhookId, error: 'Credential not found' }
          }
          const ownerUserId = rows[0].userId
          accessToken = await refreshAccessTokenIfNeeded(credentialId, ownerUserId, requestId)
        } else if (userId) {
          // Backward-compat fallback to workflow owner token
          accessToken = await getOAuthToken(userId, 'outlook')
        }

        if (!accessToken) {
          logger.error(
            `[${requestId}] Failed to get Outlook access token for webhook ${webhookId} (cred or fallback)`
          )
          return { success: false, webhookId, error: 'No access token' }
        }

        // Get webhook configuration
        const config = webhookData.providerConfig as unknown as OutlookWebhookConfig

        const now = new Date()

        // Fetch new emails
        const fetchResult = await fetchNewOutlookEmails(accessToken, config, requestId)
        const { emails } = fetchResult

        if (!emails || !emails.length) {
          // Update last checked timestamp
          await updateWebhookLastChecked(webhookId, now.toISOString())
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          return { success: true, webhookId, status: 'no_emails' }
        }

        logger.info(`[${requestId}] Found ${emails.length} emails for webhook ${webhookId}`)

        logger.info(`[${requestId}] Processing ${emails.length} emails for webhook ${webhookId}`)

        // Process emails
        const processed = await processOutlookEmails(
          emails,
          webhookData,
          config,
          accessToken,
          requestId
        )

        // Update webhook with latest timestamp
        await updateWebhookLastChecked(webhookId, now.toISOString())

        return {
          success: true,
          webhookId,
          emailsFound: emails.length,
          emailsProcessed: processed,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(`[${requestId}] Error processing Outlook webhook ${webhookId}:`, error)
        return { success: false, webhookId, error: errorMessage }
      }
    }

    for (const webhookData of activeWebhooks) {
      running.push(enqueue(webhookData))

      if (running.length >= CONCURRENCY) {
        const result = await Promise.race(running)
        running.splice(running.indexOf(result), 1)
        results.push(result)
      }
    }

    while (running.length) {
      const result = await Promise.race(running)
      running.splice(running.indexOf(result), 1)
      results.push(result)
    }

    // Calculate summary
    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    logger.info(`Outlook polling completed: ${successful} successful, ${failed} failed`)

    return {
      total: activeWebhooks.length,
      successful,
      failed,
      details: results,
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
    // Build the Microsoft Graph API URL
    const apiUrl = 'https://graph.microsoft.com/v1.0/me/messages'
    const params = new URLSearchParams()

    // Add select parameters to get the fields we need
    params.append(
      '$select',
      'id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isRead,parentFolderId'
    )

    // Add ordering (newest first)
    params.append('$orderby', 'receivedDateTime desc')

    // Limit results
    params.append('$top', (config.maxEmailsPerPoll || 25).toString())

    // Add time filter if we have a last checked timestamp
    if (config.lastCheckedTimestamp) {
      const lastChecked = new Date(config.lastCheckedTimestamp)
      // Add a small buffer to avoid missing emails due to clock differences
      const bufferTime = new Date(lastChecked.getTime() - 60000) // 1 minute buffer
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
      return { emails: [] }
    }

    const data = await response.json()
    const emails = data.value || []

    // Filter by folder if configured
    const filteredEmails = filterEmailsByFolder(emails, config)

    logger.info(
      `[${requestId}] Fetched ${emails.length} emails, ${filteredEmails.length} after filtering`
    )

    return { emails: filteredEmails }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new Outlook emails:`, errorMessage)
    return { emails: [] }
  }
}

function filterEmailsByFolder(
  emails: OutlookEmail[],
  config: OutlookWebhookConfig
): OutlookEmail[] {
  if (!config.folderIds || !config.folderIds.length) {
    return emails
  }

  return emails.filter((email) => {
    const emailFolderId = email.parentFolderId
    const hasMatchingFolder = config.folderIds!.some((configFolder) =>
      emailFolderId.toLowerCase().includes(configFolder.toLowerCase())
    )

    return config.folderFilterBehavior === 'INCLUDE'
      ? hasMatchingFolder // Include emails from matching folders
      : !hasMatchingFolder // Exclude emails from matching folders
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

  for (const email of emails) {
    try {
      const result = await pollingIdempotency.executeWithIdempotency(
        'outlook',
        `${webhookData.id}:${email.id}`,
        async () => {
          // Convert to simplified format
          const simplifiedEmail: SimplifiedOutlookEmail = {
            id: email.id,
            conversationId: email.conversationId,
            subject: email.subject || '(No Subject)',
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
            isRead: email.isRead,
            folderId: email.parentFolderId,
            // Thread support fields
            messageId: email.id,
            threadId: email.conversationId,
          }

          // Create webhook payload
          const payload: OutlookWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
          }

          // Include raw email if configured
          if (config.includeRawEmail) {
            payload.rawEmail = email
          }

          logger.info(
            `[${requestId}] Processing email: ${email.subject} from ${email.from?.emailAddress?.address}`
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
    }
  }

  return processedCount
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
    // Get current config first
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
      ...currentConfig, // Preserve ALL existing config including userId
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
