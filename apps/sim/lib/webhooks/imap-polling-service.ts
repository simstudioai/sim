import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { InferSelectModel } from 'drizzle-orm'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { FetchMessageObject, MailboxLockObject } from 'imapflow'
import { ImapFlow } from 'imapflow'
import { nanoid } from 'nanoid'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('ImapPollingService')

type WebhookRecord = InferSelectModel<typeof webhook>

interface ImapWebhookConfig {
  host: string
  port: number
  secure: boolean
  rejectUnauthorized: boolean
  username: string
  password: string
  mailbox: string | string[] // Can be single mailbox or array of mailboxes
  searchCriteria: string
  markAsRead: boolean
  includeAttachments: boolean
  lastProcessedUid?: number
  lastProcessedUidByMailbox?: Record<string, number> // Track UID per mailbox for multi-mailbox
  lastCheckedTimestamp?: string // ISO timestamp of last successful poll
  maxEmailsPerPoll?: number
}

interface ImapAttachment {
  name: string
  data: Buffer
  mimeType: string
  size: number
}

export interface SimplifiedImapEmail {
  uid: string
  messageId: string
  subject: string
  from: string
  to: string
  cc: string
  date: string | null
  bodyText: string
  bodyHtml: string
  mailbox: string
  hasAttachments: boolean
  attachments: ImapAttachment[]
}

export interface ImapWebhookPayload {
  messageId: string
  subject: string
  from: string
  to: string
  cc: string
  date: string | null
  bodyText: string
  bodyHtml: string
  mailbox: string
  hasAttachments: boolean
  attachments: ImapAttachment[]
  email: SimplifiedImapEmail
  timestamp: string
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
        failedCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as successful:`, err)
  }
}

export async function pollImapWebhooks() {
  logger.info('Starting IMAP webhook polling')

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
          eq(webhook.provider, 'imap'),
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
      logger.info('No active IMAP webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active IMAP webhooks`)

    const CONCURRENCY = 5

    const running: Promise<void>[] = []
    let successCount = 0
    let failureCount = 0

    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      const webhookId = webhookData.id
      const requestId = nanoid()

      try {
        const config = webhookData.providerConfig as unknown as ImapWebhookConfig

        if (!config.host || !config.username || !config.password) {
          logger.error(`[${requestId}] Missing IMAP credentials for webhook ${webhookId}`)
          await markWebhookFailed(webhookId)
          failureCount++
          return
        }

        const fetchResult = await fetchNewEmails(config, requestId)
        const { emails, latestUidByMailbox } = fetchResult
        const pollTimestamp = new Date().toISOString()

        if (!emails || !emails.length) {
          await updateWebhookLastProcessedUids(webhookId, latestUidByMailbox, pollTimestamp)
          await markWebhookSuccess(webhookId)
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          successCount++
          return
        }

        logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)

        const { processedCount, failedCount: emailFailedCount } = await processEmails(
          emails,
          webhookData,
          config,
          requestId
        )

        await updateWebhookLastProcessedUids(webhookId, latestUidByMailbox, pollTimestamp)

        if (emailFailedCount > 0 && processedCount === 0) {
          await markWebhookFailed(webhookId)
          failureCount++
          logger.warn(
            `[${requestId}] All ${emailFailedCount} emails failed to process for webhook ${webhookId}`
          )
        } else {
          await markWebhookSuccess(webhookId)
          successCount++
          logger.info(
            `[${requestId}] Successfully processed ${processedCount} emails for webhook ${webhookId}${emailFailedCount > 0 ? ` (${emailFailedCount} failed)` : ''}`
          )
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing IMAP webhook ${webhookId}:`, error)
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
          // Self-remove from running array when completed
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

    logger.info('IMAP polling completed', {
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
    })

    return summary
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error in IMAP polling service:', errorMessage)
    throw error
  }
}

async function fetchNewEmails(config: ImapWebhookConfig, requestId: string) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port || 993,
    secure: config.secure ?? true,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.rejectUnauthorized ?? true,
    },
    logger: false,
  })

  const emails: Array<{
    uid: number
    mailboxPath: string // Track which mailbox this email came from
    envelope: FetchMessageObject['envelope']
    bodyStructure: FetchMessageObject['bodyStructure']
    source?: Buffer
  }> = []

  const mailboxes = getMailboxesToCheck(config)
  const latestUidByMailbox: Record<string, number> = { ...(config.lastProcessedUidByMailbox || {}) }

  try {
    await client.connect()
    logger.debug(`[${requestId}] Connected to IMAP server ${config.host}`)

    const maxEmails = config.maxEmailsPerPoll || 25
    let totalEmailsCollected = 0

    for (const mailboxPath of mailboxes) {
      if (totalEmailsCollected >= maxEmails) break

      try {
        const mailbox = await client.mailboxOpen(mailboxPath)
        logger.debug(`[${requestId}] Opened mailbox: ${mailbox.path}, exists: ${mailbox.exists}`)

        // Parse search criteria - expects JSON object from UI
        let searchCriteria: any = { unseen: true }
        if (config.searchCriteria) {
          if (typeof config.searchCriteria === 'object') {
            searchCriteria = config.searchCriteria
          } else if (typeof config.searchCriteria === 'string') {
            try {
              searchCriteria = JSON.parse(config.searchCriteria)
            } catch {
              logger.warn(`[${requestId}] Invalid search criteria JSON, using default`)
            }
          }
        }

        const lastUidForMailbox = latestUidByMailbox[mailboxPath] || config.lastProcessedUid

        if (lastUidForMailbox) {
          searchCriteria = { ...searchCriteria, uid: `${lastUidForMailbox + 1}:*` }
        }

        // Add time-based filtering similar to Gmail
        // If lastCheckedTimestamp exists, use it with 1 minute buffer
        // If first poll (no timestamp), default to last 24 hours to avoid processing ALL unseen emails
        if (config.lastCheckedTimestamp) {
          const lastChecked = new Date(config.lastCheckedTimestamp)
          const bufferTime = new Date(lastChecked.getTime() - 60000)
          searchCriteria = { ...searchCriteria, since: bufferTime }
        } else {
          // First poll: only get emails from last 24 hours to avoid overwhelming first run
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
          searchCriteria = { ...searchCriteria, since: oneDayAgo }
        }

        let messageUids: number[] = []
        try {
          const searchResult = await client.search(searchCriteria, { uid: true })
          messageUids = searchResult === false ? [] : searchResult
        } catch (searchError) {
          logger.debug(
            `[${requestId}] Search returned no messages for ${mailboxPath}: ${searchError}`
          )
          continue
        }

        if (messageUids.length === 0) {
          logger.debug(`[${requestId}] No messages matching criteria in ${mailboxPath}`)
          continue
        }

        messageUids.sort((a, b) => a - b) // Sort ascending to process oldest first
        const remainingSlots = maxEmails - totalEmailsCollected
        const uidsToProcess = messageUids.slice(0, remainingSlots)

        if (uidsToProcess.length > 0) {
          latestUidByMailbox[mailboxPath] = Math.max(
            ...uidsToProcess,
            latestUidByMailbox[mailboxPath] || 0
          )
        }

        logger.info(`[${requestId}] Processing ${uidsToProcess.length} emails from ${mailboxPath}`)

        for await (const msg of client.fetch(
          uidsToProcess,
          {
            uid: true,
            envelope: true,
            bodyStructure: true,
            source: true,
          },
          { uid: true }
        )) {
          emails.push({
            uid: msg.uid,
            mailboxPath,
            envelope: msg.envelope,
            bodyStructure: msg.bodyStructure,
            source: msg.source,
          })
          totalEmailsCollected++
        }
      } catch (mailboxError) {
        logger.warn(`[${requestId}] Error processing mailbox ${mailboxPath}:`, mailboxError)
      }
    }

    await client.logout()
    logger.debug(`[${requestId}] Disconnected from IMAP server`)

    return { emails, latestUidByMailbox }
  } catch (error) {
    try {
      await client.logout()
    } catch {
      // Ignore logout errors
    }
    throw error
  }
}

/**
 * Get the list of mailboxes to check based on config
 */
function getMailboxesToCheck(config: ImapWebhookConfig): string[] {
  if (!config.mailbox || (Array.isArray(config.mailbox) && config.mailbox.length === 0)) {
    return ['INBOX']
  }
  if (Array.isArray(config.mailbox)) {
    return config.mailbox
  }
  return [config.mailbox]
}

function parseEmailAddress(
  addr: { name?: string; address?: string } | { name?: string; address?: string }[] | undefined
): string {
  if (!addr) return ''
  if (Array.isArray(addr)) {
    return addr
      .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address || ''))
      .filter(Boolean)
      .join(', ')
  }
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address || ''
}

function extractTextFromSource(source: Buffer): { text: string; html: string } {
  const content = source.toString('utf-8')
  let text = ''
  let html = ''

  const parts = content.split(/--[^\r\n]+/)

  for (const part of parts) {
    const lowerPart = part.toLowerCase()

    if (lowerPart.includes('content-type: text/plain')) {
      const match = part.match(/\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i)
      if (match) {
        text = match[1].trim()
        if (lowerPart.includes('quoted-printable')) {
          text = text
            .replace(/=\r?\n/g, '')
            .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        }
        if (lowerPart.includes('base64')) {
          try {
            text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf-8')
          } catch {
            // Keep as-is if base64 decode fails
          }
        }
      }
    } else if (lowerPart.includes('content-type: text/html')) {
      const match = part.match(/\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i)
      if (match) {
        html = match[1].trim()
        if (lowerPart.includes('quoted-printable')) {
          html = html
            .replace(/=\r?\n/g, '')
            .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        }
        if (lowerPart.includes('base64')) {
          try {
            html = Buffer.from(html.replace(/\s/g, ''), 'base64').toString('utf-8')
          } catch {
            // Keep as-is if base64 decode fails
          }
        }
      }
    }
  }

  if (!text && !html) {
    const bodyMatch = content.match(/\r?\n\r?\n([\s\S]+)$/)
    if (bodyMatch) {
      text = bodyMatch[1].trim()
    }
  }

  return { text, html }
}

function extractAttachmentsFromSource(
  source: Buffer,
  bodyStructure: FetchMessageObject['bodyStructure']
): ImapAttachment[] {
  const attachments: ImapAttachment[] = []

  if (!bodyStructure) return attachments

  const content = source.toString('utf-8')
  const parts = content.split(/--[^\r\n]+/)

  for (const part of parts) {
    const lowerPart = part.toLowerCase()

    const dispositionMatch = part.match(
      /content-disposition:\s*attachment[^;]*;\s*filename="?([^"\r\n]+)"?/i
    )
    const filenameMatch = part.match(/name="?([^"\r\n]+)"?/i)
    const contentTypeMatch = part.match(/content-type:\s*([^;\r\n]+)/i)

    if (
      dispositionMatch ||
      (filenameMatch && !lowerPart.includes('text/plain') && !lowerPart.includes('text/html'))
    ) {
      const filename = dispositionMatch?.[1] || filenameMatch?.[1] || 'attachment'
      const mimeType = contentTypeMatch?.[1]?.trim() || 'application/octet-stream'

      const dataMatch = part.match(/\r?\n\r?\n([\s\S]*?)$/i)
      if (dataMatch) {
        const data = dataMatch[1].trim()

        if (lowerPart.includes('base64')) {
          try {
            const buffer = Buffer.from(data.replace(/\s/g, ''), 'base64')
            attachments.push({
              name: filename,
              data: buffer,
              mimeType,
              size: buffer.length,
            })
          } catch {
            // Skip if decode fails
          }
        }
      }
    }
  }

  return attachments
}

/**
 * Checks if a body structure contains attachments by examining disposition
 */
function hasAttachmentsInBodyStructure(structure: FetchMessageObject['bodyStructure']): boolean {
  if (!structure) return false

  if (structure.disposition === 'attachment') {
    return true
  }

  if (structure.disposition === 'inline' && structure.dispositionParameters?.filename) {
    return true
  }

  if (structure.childNodes && Array.isArray(structure.childNodes)) {
    return structure.childNodes.some((child) => hasAttachmentsInBodyStructure(child))
  }

  return false
}

async function processEmails(
  emails: Array<{
    uid: number
    mailboxPath: string
    envelope: FetchMessageObject['envelope']
    bodyStructure: FetchMessageObject['bodyStructure']
    source?: Buffer
  }>,
  webhookData: WebhookRecord,
  config: ImapWebhookConfig,
  requestId: string
) {
  let processedCount = 0
  let failedCount = 0

  const client = new ImapFlow({
    host: config.host,
    port: config.port || 993,
    secure: config.secure ?? true,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.rejectUnauthorized ?? true,
    },
    logger: false,
  })

  let currentOpenMailbox: string | null = null
  const lockState: { lock: MailboxLockObject | null } = { lock: null }

  try {
    if (config.markAsRead) {
      await client.connect()
    }

    for (const email of emails) {
      try {
        await pollingIdempotency.executeWithIdempotency(
          'imap',
          `${webhookData.id}:${email.mailboxPath}:${email.uid}`,
          async () => {
            const envelope = email.envelope

            const { text: bodyText, html: bodyHtml } = email.source
              ? extractTextFromSource(email.source)
              : { text: '', html: '' }

            let attachments: ImapAttachment[] = []
            const hasAttachments = hasAttachmentsInBodyStructure(email.bodyStructure)

            if (config.includeAttachments && hasAttachments && email.source) {
              attachments = extractAttachmentsFromSource(email.source, email.bodyStructure)
            }

            const simplifiedEmail: SimplifiedImapEmail = {
              uid: String(email.uid),
              messageId: envelope?.messageId || '',
              subject: envelope?.subject || '[No Subject]',
              from: parseEmailAddress(envelope?.from),
              to: parseEmailAddress(envelope?.to),
              cc: parseEmailAddress(envelope?.cc),
              date: envelope?.date ? new Date(envelope.date).toISOString() : null,
              bodyText,
              bodyHtml,
              mailbox: email.mailboxPath,
              hasAttachments,
              attachments,
            }

            const payload: ImapWebhookPayload = {
              messageId: simplifiedEmail.messageId,
              subject: simplifiedEmail.subject,
              from: simplifiedEmail.from,
              to: simplifiedEmail.to,
              cc: simplifiedEmail.cc,
              date: simplifiedEmail.date,
              bodyText: simplifiedEmail.bodyText,
              bodyHtml: simplifiedEmail.bodyHtml,
              mailbox: simplifiedEmail.mailbox,
              hasAttachments: simplifiedEmail.hasAttachments,
              attachments: simplifiedEmail.attachments,
              email: simplifiedEmail,
              timestamp: new Date().toISOString(),
            }

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
                `[${requestId}] Failed to trigger webhook for email ${email.uid}:`,
                response.status,
                errorText
              )
              throw new Error(`Webhook request failed: ${response.status} - ${errorText}`)
            }

            if (config.markAsRead) {
              try {
                if (currentOpenMailbox !== email.mailboxPath) {
                  if (lockState.lock) {
                    lockState.lock.release()
                    lockState.lock = null
                  }
                  lockState.lock = await client.getMailboxLock(email.mailboxPath)
                  currentOpenMailbox = email.mailboxPath
                }
                await client.messageFlagsAdd({ uid: email.uid }, ['\\Seen'], { uid: true })
              } catch (flagError) {
                logger.warn(
                  `[${requestId}] Failed to mark message ${email.uid} as read:`,
                  flagError
                )
              }
            }

            return {
              emailUid: email.uid,
              webhookStatus: response.status,
              processed: true,
            }
          }
        )

        logger.info(
          `[${requestId}] Successfully processed email ${email.uid} from ${email.mailboxPath} for webhook ${webhookData.id}`
        )
        processedCount++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(`[${requestId}] Error processing email ${email.uid}:`, errorMessage)
        failedCount++
      }
    }
  } finally {
    if (config.markAsRead) {
      try {
        if (lockState.lock) {
          lockState.lock.release()
        }
        await client.logout()
      } catch {
        // Ignore logout errors
      }
    }
  }

  return { processedCount, failedCount }
}

async function updateWebhookLastProcessedUids(
  webhookId: string,
  uidByMailbox: Record<string, number>,
  timestamp: string
) {
  const result = await db.select().from(webhook).where(eq(webhook.id, webhookId))
  const existingConfig = (result[0]?.providerConfig as Record<string, any>) || {}

  const existingUidByMailbox = existingConfig.lastProcessedUidByMailbox || {}
  const mergedUidByMailbox = { ...existingUidByMailbox }

  for (const [mailbox, uid] of Object.entries(uidByMailbox)) {
    mergedUidByMailbox[mailbox] = Math.max(uid, mergedUidByMailbox[mailbox] || 0)
  }

  await db
    .update(webhook)
    .set({
      providerConfig: {
        ...existingConfig,
        lastProcessedUidByMailbox: mergedUidByMailbox,
        lastCheckedTimestamp: timestamp,
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(webhook.id, webhookId))
}
