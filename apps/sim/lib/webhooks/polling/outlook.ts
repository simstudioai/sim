import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { htmlToText } from 'html-to-text'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { AttachmentDownloadBudget } from '@/lib/uploads/utils/attachment-download-budget'
import {
  getProviderConfig,
  type PollingProviderHandler,
  type PollOutcome,
  type PollWebhookContext,
} from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  PollAdmissionRefusedError,
  resolveOAuthCredential,
  skipAdmissionRefusedPoll,
  throwIfAdmissionRefused,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'
import { downloadAttachments } from '@/tools/outlook/read'
import type { OutlookAttachment } from '@/tools/outlook/types'

interface OutlookWebhookConfig {
  credentialId: string
  folderIds?: string[]
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
  bccRecipients?: OutlookEmailRecipient[]
  replyTo?: OutlookEmailRecipient[]
  receivedDateTime: string
  sentDateTime: string
  hasAttachments: boolean
  isRead: boolean
  parentFolderId: string
  internetMessageId?: string
  importance?: string
  categories?: string[]
  flag?: { flagStatus?: string }
  webLink?: string
}

interface OutlookEmailRecipient {
  emailAddress?: {
    name?: string
    address?: string
  }
}

interface SimplifiedOutlookEmail {
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
  bcc: string
  replyTo: string
  internetMessageId: string | null
  importance: string | null
  categories: string[]
  flagStatus: string | null
  bodyPreview: string
  webLink: string | null
}

function joinAddresses(recipients: OutlookEmailRecipient[] | undefined): string {
  return (
    recipients
      ?.map((recipient) => recipient.emailAddress?.address)
      .filter((address): address is string => Boolean(address))
      .join(', ') ?? ''
  )
}

interface OutlookWebhookPayload {
  email: SimplifiedOutlookEmail
  timestamp: string
  rawEmail?: OutlookEmail
}

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

export const outlookPollingHandler: PollingProviderHandler = {
  provider: 'outlook',
  label: 'Outlook',

  async pollWebhook(ctx: PollWebhookContext): Promise<PollOutcome> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      logger.info(`Processing Outlook webhook: ${webhookId}`)

      const accessToken = await resolveOAuthCredential(webhookData, 'outlook', requestId)
      const config = getProviderConfig<OutlookWebhookConfig>(webhookData.providerConfig)
      const now = new Date()

      const { emails } = await fetchNewOutlookEmails(accessToken, config, logger)

      if (!emails || !emails.length) {
        await updateWebhookProviderConfig(
          webhookId,
          { lastCheckedTimestamp: now.toISOString() },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(`No new emails found for webhook ${webhookId}`)
        return 'success'
      }

      logger.info(`Found ${emails.length} emails for webhook ${webhookId}`)

      const { processedCount, failedCount } = await processOutlookEmails(
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
        { lastCheckedTimestamp: now.toISOString() },
        logger
      )

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(`All ${failedCount} emails failed to process for webhook ${webhookId}`)
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `Successfully processed ${processedCount} emails for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      if (error instanceof PollAdmissionRefusedError) {
        return skipAdmissionRefusedPoll(logger, webhookId)
      }
      logger.error(`Error processing Outlook webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

/** Hard cap on total emails fetched per poll to prevent unbounded pagination loops. */
const OUTLOOK_HARD_MAX_EMAILS = 200

/** Number of items to request per Graph API page. Decoupled from the total cap so pagination actually runs. */
const OUTLOOK_PAGE_SIZE = 50

async function fetchNewOutlookEmails(
  accessToken: string,
  config: OutlookWebhookConfig,
  logger: Logger
) {
  try {
    const apiUrl = 'https://graph.microsoft.com/v1.0/me/messages'
    const params = new URLSearchParams()

    params.append(
      '$select',
      'id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,hasAttachments,isRead,parentFolderId,internetMessageId,importance,categories,flag,webLink'
    )
    params.append('$orderby', 'receivedDateTime desc')
    const maxEmails = Math.min(config.maxEmailsPerPoll || 25, OUTLOOK_HARD_MAX_EMAILS)
    params.append('$top', OUTLOOK_PAGE_SIZE.toString())

    if (config.lastCheckedTimestamp) {
      const lastChecked = new Date(config.lastCheckedTimestamp)
      const bufferTime = new Date(lastChecked.getTime() - 60000)
      params.append('$filter', `receivedDateTime gt ${bufferTime.toISOString()}`)
    }
    const allEmails: OutlookEmail[] = []
    let nextUrl: string | undefined = `${apiUrl}?${params.toString()}`
    logger.info(`Fetching emails from: ${nextUrl}`)

    while (nextUrl && allEmails.length < maxEmails) {
      const response = await fetchWithRetry(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: 'Unknown error' } }))
        logger.error('Microsoft Graph API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        })
        throw new Error(
          `Microsoft Graph API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
        )
      }

      const data = await response.json()
      const pageEmails: OutlookEmail[] = data.value || []
      const remaining = maxEmails - allEmails.length
      allEmails.push(...pageEmails.slice(0, remaining))

      nextUrl =
        allEmails.length < maxEmails ? (data['@odata.nextLink'] as string | undefined) : undefined

      if (pageEmails.length === 0) break
    }

    logger.info(`Fetched ${allEmails.length} emails total`)

    const emails = allEmails

    let resolvedFolderIds: Map<string, string> | undefined
    let skipFolderFilter = false
    if (config.folderIds && config.folderIds.length > 0) {
      const wellKnownFolders = config.folderIds.filter(isWellKnownFolderName)
      if (wellKnownFolders.length > 0) {
        resolvedFolderIds = await resolveWellKnownFolderIds(accessToken, config.folderIds, logger)
        if (resolvedFolderIds.size < wellKnownFolders.length) {
          logger.warn(
            `Could not resolve all well-known folders (${resolvedFolderIds.size}/${wellKnownFolders.length}) — skipping folder filter to avoid incorrect results`
          )
          skipFolderFilter = true
        }
      }
    }

    const filteredEmails = skipFolderFilter
      ? emails
      : filterEmailsByFolder(emails, config, resolvedFolderIds)

    logger.info(`Fetched ${emails.length} emails, ${filteredEmails.length} after filtering`)

    return { emails: filteredEmails }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error')
    logger.error('Error fetching new Outlook emails:', errorMessage)
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
  logger: Logger
): Promise<string | null> {
  try {
    const response = await fetchWithRetry(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderName}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      logger.warn(`Failed to resolve well-known folder '${folderName}': ${response.status}`)
      return null
    }

    const folder = await response.json()
    return folder.id || null
  } catch (error) {
    logger.error(`Error resolving well-known folder '${folderName}':`, error)
    return null
  }
}

async function resolveWellKnownFolderIds(
  accessToken: string,
  folderIds: string[],
  logger: Logger
): Promise<Map<string, string>> {
  const resolvedIds = new Map<string, string>()
  const wellKnownFolders = folderIds.filter(isWellKnownFolderName)
  if (wellKnownFolders.length === 0) return resolvedIds

  const resolutions = await Promise.all(
    wellKnownFolders.map(async (folderName) => {
      const actualId = await resolveWellKnownFolderId(accessToken, folderName, logger)
      return { folderName, actualId }
    })
  )

  for (const { folderName, actualId } of resolutions) {
    if (actualId) {
      resolvedIds.set(folderName.toLowerCase(), actualId)
    }
  }

  logger.info(`Resolved ${resolvedIds.size}/${wellKnownFolders.length} well-known folders`)
  return resolvedIds
}

function filterEmailsByFolder(
  emails: OutlookEmail[],
  config: OutlookWebhookConfig,
  resolvedFolderIds?: Map<string, string>
): OutlookEmail[] {
  if (!config.folderIds || !config.folderIds.length) return emails

  const actualFolderIds = config.folderIds.map((configFolder) => {
    if (resolvedFolderIds && isWellKnownFolderName(configFolder)) {
      const resolvedId = resolvedFolderIds.get(configFolder.toLowerCase())
      if (resolvedId) return resolvedId
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
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  config: OutlookWebhookConfig,
  accessToken: string,
  requestId: string,
  logger: Logger
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
              attachments = await downloadAttachments(
                email.id,
                accessToken,
                new AttachmentDownloadBudget(),
                {
                  fetchImpl: (url, init) => fetchWithRetry(url, init),
                  keepPartialOnLimit: true,
                  preferMetadataSize: true,
                  onSkip: (attachmentName, declaredSize) =>
                    logger.warn('Skipping Outlook attachment over the per-email byte budget', {
                      emailId: email.id,
                      attachmentName,
                      declaredSize,
                    }),
                  onFailure: (stage, status) =>
                    logger.warn('Outlook attachment request failed', {
                      emailId: email.id,
                      stage,
                      status,
                    }),
                }
              )
            } catch (error) {
              logger.error(`Error downloading attachments for email ${email.id}:`, error)
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
              if (!content) return email.bodyPreview || ''
              if (type === 'text' || type === 'text/plain') return content
              return convertHtmlToPlainText(content)
            })(),
            bodyHtml: email.body?.content || '',
            hasAttachments: email.hasAttachments,
            attachments,
            isRead: email.isRead,
            folderId: email.parentFolderId,
            messageId: email.id,
            threadId: email.conversationId,
            bcc: joinAddresses(email.bccRecipients),
            replyTo: joinAddresses(email.replyTo),
            internetMessageId: email.internetMessageId ?? null,
            importance: email.importance ?? null,
            categories: email.categories ?? [],
            flagStatus: email.flag?.flagStatus ?? null,
            bodyPreview: email.bodyPreview ?? '',
            webLink: email.webLink ?? null,
          }

          const payload: OutlookWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
          }

          if (config.includeRawEmail) {
            payload.rawEmail = email
          }

          logger.info(
            `Processing email: ${email.subject} from ${email.from?.emailAddress?.address}`
          )

          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            requestId
          )

          if (!result.success) {
            throwIfAdmissionRefused(result)
            logger.error(
              `Failed to process webhook for email ${email.id}:`,
              result.statusCode,
              result.error
            )
            throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
          }

          if (config.markAsRead) {
            await markOutlookEmailAsRead(accessToken, email.id, logger)
          }

          return { emailId: email.id, processed: true }
        }
      )

      logger.info(`Successfully processed email ${email.id} for webhook ${webhookData.id}`)
      processedCount++
    } catch (error) {
      if (error instanceof PollAdmissionRefusedError && processedCount === 0) throw error
      logger.error(`Error processing email ${email.id}:`, error)
      failedCount++
    }
  }

  return { processedCount, failedCount }
}

async function markOutlookEmailAsRead(accessToken: string, messageId: string, logger: Logger) {
  try {
    const response = await fetchWithRetry(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead: true }),
      }
    )

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
