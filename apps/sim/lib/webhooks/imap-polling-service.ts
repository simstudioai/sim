import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import type { FetchMessageObject } from 'imapflow'
import { ImapFlow } from 'imapflow'
import { nanoid } from 'nanoid'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('ImapPollingService')

interface ImapWebhookConfig {
  host: string
  port: number
  secure: boolean
  rejectUnauthorized: boolean
  username: string
  password: string
  mailbox: string
  searchCriteria: string
  markAsRead: boolean
  includeAttachments: boolean
  lastProcessedUid?: number
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
      .where(
        and(eq(webhook.provider, 'imap'), eq(webhook.isActive, true), eq(workflow.isDeployed, true))
      )

    const activeWebhooks = activeWebhooksResult.map((r) => r.webhook)

    if (!activeWebhooks.length) {
      logger.info('No active IMAP webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active IMAP webhooks`)

    // Limit concurrency to avoid overwhelming IMAP servers
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
        const { emails, latestUid } = fetchResult

        if (!emails || !emails.length) {
          if (latestUid && latestUid !== config.lastProcessedUid) {
            await updateWebhookLastProcessedUid(webhookId, latestUid)
          }
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

        if (latestUid) {
          await updateWebhookLastProcessedUid(webhookId, latestUid)
        }

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
      const promise = enqueue(webhookData)
        .then(() => {})
        .catch((err) => {
          logger.error('Unexpected error in webhook processing:', err)
          failureCount++
        })

      running.push(promise)

      if (running.length >= CONCURRENCY) {
        const completedIdx = await Promise.race(running.map((p, i) => p.then(() => i)))
        running.splice(completedIdx, 1)
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
    envelope: FetchMessageObject['envelope']
    bodyStructure: FetchMessageObject['bodyStructure']
    source?: Buffer
  }> = []
  let latestUid = config.lastProcessedUid

  try {
    await client.connect()
    logger.debug(`[${requestId}] Connected to IMAP server ${config.host}`)

    const mailbox = await client.mailboxOpen(config.mailbox || 'INBOX')
    logger.debug(`[${requestId}] Opened mailbox: ${mailbox.path}, exists: ${mailbox.exists}`)

    // Build search criteria
    let searchCriteria: any = config.searchCriteria || 'UNSEEN'

    // If we have a last processed UID, add UID filter
    if (config.lastProcessedUid) {
      // Search for messages with UID greater than last processed
      const uidCriteria = { uid: `${config.lastProcessedUid + 1}:*` }
      if (typeof searchCriteria === 'string') {
        searchCriteria = { [searchCriteria]: true, ...uidCriteria }
      } else {
        searchCriteria = { ...searchCriteria, ...uidCriteria }
      }
    }

    // Search for matching messages
    const messageUids: number[] = []
    try {
      for await (const msg of client.fetch(searchCriteria, { uid: true })) {
        messageUids.push(msg.uid)
      }
    } catch (fetchError) {
      // If search fails (e.g., no messages match), return empty
      logger.debug(`[${requestId}] Fetch returned no messages or failed: ${fetchError}`)
      await client.logout()
      return { emails: [], latestUid }
    }

    if (messageUids.length === 0) {
      logger.debug(`[${requestId}] No messages matching criteria`)
      await client.logout()
      return { emails: [], latestUid }
    }

    // Sort UIDs and take the most recent ones
    messageUids.sort((a, b) => b - a)
    const maxEmails = config.maxEmailsPerPoll || 25
    const uidsToProcess = messageUids.slice(0, maxEmails)
    latestUid = Math.max(...uidsToProcess, config.lastProcessedUid || 0)

    logger.info(`[${requestId}] Processing ${uidsToProcess.length} emails from ${config.mailbox}`)

    // Fetch full message details
    for await (const msg of client.fetch(uidsToProcess, {
      uid: true,
      envelope: true,
      bodyStructure: true,
      source: true,
    })) {
      emails.push({
        uid: msg.uid,
        envelope: msg.envelope,
        bodyStructure: msg.bodyStructure,
        source: msg.source,
      })
    }

    await client.logout()
    logger.debug(`[${requestId}] Disconnected from IMAP server`)

    return { emails, latestUid }
  } catch (error) {
    try {
      await client.logout()
    } catch {
      // Ignore logout errors
    }
    throw error
  }
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

  // Simple extraction - look for Content-Type boundaries
  const parts = content.split(/--[^\r\n]+/)

  for (const part of parts) {
    const lowerPart = part.toLowerCase()

    if (lowerPart.includes('content-type: text/plain')) {
      // Extract text content after headers (double newline)
      const match = part.match(/\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i)
      if (match) {
        text = match[1].trim()
        // Handle quoted-printable decoding
        if (lowerPart.includes('quoted-printable')) {
          text = text
            .replace(/=\r?\n/g, '')
            .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        }
        // Handle base64 decoding
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

  // If no multipart, try to get the body directly
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

    // Look for attachment dispositions or non-text content types
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

      // Extract the attachment data
      const dataMatch = part.match(/\r?\n\r?\n([\s\S]*?)$/i)
      if (dataMatch) {
        const data = dataMatch[1].trim()

        // Most attachments are base64 encoded
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

async function processEmails(
  emails: Array<{
    uid: number
    envelope: FetchMessageObject['envelope']
    bodyStructure: FetchMessageObject['bodyStructure']
    source?: Buffer
  }>,
  webhookData: any,
  config: ImapWebhookConfig,
  requestId: string
) {
  let processedCount = 0
  let failedCount = 0

  // Create a new client for marking messages
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

  try {
    if (config.markAsRead) {
      await client.connect()
      await client.mailboxOpen(config.mailbox || 'INBOX')
    }

    for (const email of emails) {
      try {
        await pollingIdempotency.executeWithIdempotency(
          'imap',
          `${webhookData.id}:${email.uid}`,
          async () => {
            const envelope = email.envelope

            // Extract body content
            const { text: bodyText, html: bodyHtml } = email.source
              ? extractTextFromSource(email.source)
              : { text: '', html: '' }

            // Extract attachments if enabled
            let attachments: ImapAttachment[] = []
            const hasAttachments = email.bodyStructure
              ? JSON.stringify(email.bodyStructure).toLowerCase().includes('attachment')
              : false

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
              mailbox: config.mailbox || 'INBOX',
              hasAttachments,
              attachments,
            }

            const payload: ImapWebhookPayload = {
              email: simplifiedEmail,
              timestamp: new Date().toISOString(),
            }

            const webhookUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhookData.path}`

            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Secret': webhookData.secret || '',
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

            // Mark as read if configured
            if (config.markAsRead) {
              try {
                await client.messageFlagsAdd({ uid: email.uid }, ['\\Seen'])
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
          `[${requestId}] Successfully processed email ${email.uid} for webhook ${webhookData.id}`
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
        await client.logout()
      } catch {
        // Ignore logout errors
      }
    }
  }

  return { processedCount, failedCount }
}

async function updateWebhookLastProcessedUid(webhookId: string, uid: number) {
  const result = await db.select().from(webhook).where(eq(webhook.id, webhookId))
  const existingConfig = (result[0]?.providerConfig as Record<string, any>) || {}
  await db
    .update(webhook)
    .set({
      providerConfig: {
        ...existingConfig,
        lastProcessedUid: uid,
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(webhook.id, webhookId))
}
