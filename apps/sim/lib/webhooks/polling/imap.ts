import type { FetchMessageObject, MailboxLockObject } from 'imapflow'
import { ImapFlow } from 'imapflow'
import { pollingIdempotency } from '@/lib/core/idempotency/service'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import type { PollingProviderHandler, PollWebhookContext } from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'

interface ImapWebhookConfig {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  mailbox: string | string[]
  searchCriteria: string
  markAsRead: boolean
  includeAttachments: boolean
  lastProcessedUid?: number
  lastProcessedUidByMailbox?: Record<string, number>
  uidValidityByMailbox?: Record<string, string>
  lastCheckedTimestamp?: string
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

export const imapPollingHandler: PollingProviderHandler = {
  provider: 'imap',
  label: 'IMAP',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const config = webhookData.providerConfig as unknown as ImapWebhookConfig

      if (!config.host || !config.username || !config.password) {
        logger.error(`[${requestId}] Missing IMAP credentials for webhook ${webhookId}`)
        await markWebhookFailed(webhookId, logger)
        return 'failure'
      }

      const hostValidation = await validateDatabaseHost(config.host, 'host')
      if (!hostValidation.isValid) {
        logger.error(
          `[${requestId}] IMAP host validation failed for webhook ${webhookId}: ${hostValidation.error}`
        )
        await markWebhookFailed(webhookId, logger)
        return 'failure'
      }

      const client = new ImapFlow({
        host: hostValidation.resolvedIP!,
        servername: config.host,
        port: config.port || 993,
        secure: config.secure ?? true,
        auth: {
          user: config.username,
          pass: config.password,
        },
        tls: { rejectUnauthorized: true },
        logger: false,
      })

      let emails: Awaited<ReturnType<typeof fetchNewEmails>>['emails'] = []
      let latestUidByMailbox: Record<string, number> = {}
      let uidValidityByMailbox: Record<string, string> = {}

      try {
        await client.connect()

        const result = await fetchNewEmails(client, config, requestId, logger)
        emails = result.emails
        latestUidByMailbox = result.latestUidByMailbox
        uidValidityByMailbox = result.uidValidityByMailbox

        const pollTimestamp = new Date().toISOString()

        if (!emails.length) {
          await updateImapState(
            webhookId,
            latestUidByMailbox,
            pollTimestamp,
            config,
            logger,
            uidValidityByMailbox
          )
          await markWebhookSuccess(webhookId, logger)
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          await client.logout()
          return 'success'
        }

        logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)

        const { processedCount, failedCount } = await processEmails(
          emails,
          webhookData,
          workflowData,
          config,
          client,
          requestId,
          logger
        )

        await updateImapState(
          webhookId,
          latestUidByMailbox,
          pollTimestamp,
          config,
          logger,
          uidValidityByMailbox
        )

        await client.logout()

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
      } catch (innerError) {
        try {
          await client.logout()
        } catch {}
        throw innerError
      }
    } catch (error) {
      logger.error(`[${requestId}] Error processing IMAP webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function updateImapState(
  webhookId: string,
  uidByMailbox: Record<string, number>,
  timestamp: string,
  config: ImapWebhookConfig,
  logger: ReturnType<typeof import('@sim/logger').createLogger>,
  uidValidityByMailbox: Record<string, string>
) {
  const existingUidByMailbox = config.lastProcessedUidByMailbox || {}
  const prevUidValidity = config.uidValidityByMailbox || {}

  const resetMailboxes = new Set(
    Object.entries(uidValidityByMailbox)
      .filter(
        ([mailbox, validity]) =>
          prevUidValidity[mailbox] !== undefined && prevUidValidity[mailbox] !== validity
      )
      .map(([mailbox]) => mailbox)
  )

  const mergedUidByMailbox: Record<string, number> = {}

  for (const [mailbox, uid] of Object.entries(existingUidByMailbox)) {
    if (!resetMailboxes.has(mailbox)) {
      mergedUidByMailbox[mailbox] = uid
    }
  }

  for (const [mailbox, uid] of Object.entries(uidByMailbox)) {
    if (resetMailboxes.has(mailbox)) {
      mergedUidByMailbox[mailbox] = uid
    } else {
      mergedUidByMailbox[mailbox] = Math.max(uid, mergedUidByMailbox[mailbox] || 0)
    }
  }

  await updateWebhookProviderConfig(
    webhookId,
    {
      lastProcessedUidByMailbox: mergedUidByMailbox,
      lastCheckedTimestamp: timestamp,
      uidValidityByMailbox,
    },
    logger
  )
}

async function fetchNewEmails(
  client: ImapFlow,
  config: ImapWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
) {
  const emails: Array<{
    uid: number
    mailboxPath: string
    envelope: FetchMessageObject['envelope']
    bodyStructure: FetchMessageObject['bodyStructure']
    source?: Buffer
  }> = []

  const mailboxes = getMailboxesToCheck(config)
  const latestUidByMailbox: Record<string, number> = { ...(config.lastProcessedUidByMailbox || {}) }
  const uidValidityByMailbox: Record<string, string> = { ...(config.uidValidityByMailbox || {}) }

  const maxEmails = config.maxEmailsPerPoll || 25
  let totalEmailsCollected = 0

  for (const mailboxPath of mailboxes) {
    if (totalEmailsCollected >= maxEmails) break

    try {
      const mailbox = await client.mailboxOpen(mailboxPath)

      const currentUidValidity = mailbox.uidValidity.toString()
      const storedUidValidity = uidValidityByMailbox[mailboxPath]

      if (storedUidValidity && storedUidValidity !== currentUidValidity) {
        logger.warn(
          `[${requestId}] UIDVALIDITY changed for ${mailboxPath} (${storedUidValidity} -> ${currentUidValidity}), discarding stored UID`
        )
        delete latestUidByMailbox[mailboxPath]
      }
      uidValidityByMailbox[mailboxPath] = currentUidValidity

      let searchCriteria: Record<string, unknown> = { unseen: true }
      if (config.searchCriteria) {
        if (typeof config.searchCriteria === 'object') {
          searchCriteria = config.searchCriteria as unknown as Record<string, unknown>
        } else if (typeof config.searchCriteria === 'string') {
          try {
            searchCriteria = JSON.parse(config.searchCriteria)
          } catch {
            logger.warn(`[${requestId}] Invalid search criteria JSON, using default`)
          }
        }
      }

      const lastUidForMailbox = latestUidByMailbox[mailboxPath]

      if (lastUidForMailbox) {
        searchCriteria = { ...searchCriteria, uid: `${lastUidForMailbox + 1}:*` }
      }

      if (config.lastCheckedTimestamp) {
        const lastChecked = new Date(config.lastCheckedTimestamp)
        const bufferTime = new Date(lastChecked.getTime() - 60000)
        searchCriteria = { ...searchCriteria, since: bufferTime }
      } else {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        searchCriteria = { ...searchCriteria, since: oneDayAgo }
      }

      let messageUids: number[] = []
      try {
        const searchResult = await client.search(searchCriteria, { uid: true })
        messageUids = searchResult === false ? [] : searchResult
      } catch {
        continue
      }

      if (messageUids.length === 0) continue

      messageUids.sort((a, b) => a - b)
      const remainingSlots = maxEmails - totalEmailsCollected
      const uidsToProcess = messageUids.slice(0, remainingSlots)

      for await (const msg of client.fetch(
        uidsToProcess,
        { uid: true, envelope: true, bodyStructure: true, source: true },
        { uid: true }
      )) {
        emails.push({
          uid: msg.uid,
          mailboxPath,
          envelope: msg.envelope,
          bodyStructure: msg.bodyStructure,
          source: msg.source,
        })
        if (msg.uid > (latestUidByMailbox[mailboxPath] || 0)) {
          latestUidByMailbox[mailboxPath] = msg.uid
        }
        totalEmailsCollected++
      }
    } catch (mailboxError) {
      logger.warn(`[${requestId}] Error processing mailbox ${mailboxPath}:`, mailboxError)
    }
  }

  return { emails, latestUidByMailbox, uidValidityByMailbox }
}

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
          } catch {}
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
          } catch {}
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
          } catch {}
        }
      }
    }
  }

  return attachments
}

function hasAttachmentsInBodyStructure(structure: FetchMessageObject['bodyStructure']): boolean {
  if (!structure) return false
  if (structure.disposition === 'attachment') return true
  if (structure.disposition === 'inline' && structure.dispositionParameters?.filename) return true
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
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  config: ImapWebhookConfig,
  client: ImapFlow,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
) {
  let processedCount = 0
  let failedCount = 0

  let currentOpenMailbox: string | null = null
  const lockState: { lock: MailboxLockObject | null } = { lock: null }

  try {
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

            const result = await processPolledWebhookEvent(
              webhookData,
              workflowData,
              payload,
              requestId
            )

            if (!result.success) {
              logger.error(
                `[${requestId}] Failed to process webhook for email ${email.uid}:`,
                result.statusCode,
                result.error
              )
              throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
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
                await client.messageFlagsAdd(email.uid, ['\\Seen'], { uid: true })
              } catch (flagError) {
                logger.warn(
                  `[${requestId}] Failed to mark message ${email.uid} as read:`,
                  flagError
                )
              }
            }

            return { emailUid: email.uid, processed: true }
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
    if (lockState.lock) {
      try {
        lockState.lock.release()
      } catch {}
    }
  }

  return { processedCount, failedCount }
}
