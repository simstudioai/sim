import crypto from 'crypto'
import { db, workflowDeploymentVersion } from '@sim/db'
import { account, webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import { generateShortId } from '@/lib/core/utils/uuid'
import type { DbOrTx } from '@/lib/db/types'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import {
  getCredentialsForCredentialSet,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'
import { isPollingWebhookProvider } from '@/triggers/constants'

const logger = createLogger('WebhookUtils')

/**
 * Fetches a URL with DNS pinning to prevent DNS rebinding attacks
 * @param url - The URL to fetch
 * @param accessToken - Authorization token (optional for pre-signed URLs)
 * @param requestId - Request ID for logging
 * @returns The fetch Response or null if validation fails
 */
async function fetchWithDNSPinning(
  url: string,
  accessToken: string,
  requestId: string
): Promise<SecureFetchResponse | null> {
  try {
    const urlValidation = await validateUrlWithDNS(url, 'contentUrl')
    if (!urlValidation.isValid) {
      logger.warn(`[${requestId}] Invalid content URL: ${urlValidation.error}`, {
        url,
      })
      return null
    }

    const headers: Record<string, string> = {}

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }

    const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
      headers,
    })

    return response
  } catch (error) {
    logger.error(`[${requestId}] Error fetching URL with DNS pinning`, {
      error: error instanceof Error ? error.message : String(error),
      url: sanitizeUrlForLog(url),
    })
    return null
  }
}

/**
 * Format Microsoft Teams Graph change notification
 */
async function formatTeamsGraphNotification(
  body: any,
  foundWebhook: any,
  foundWorkflow: any,
  request: NextRequest
): Promise<any> {
  const notification = body.value?.[0]
  if (!notification) {
    logger.warn('Received empty Teams notification body')
    return null
  }
  const changeType = notification.changeType || 'created'
  const resource = notification.resource || ''
  const subscriptionId = notification.subscriptionId || ''

  let chatId: string | null = null
  let messageId: string | null = null

  const fullMatch = resource.match(/chats\/([^/]+)\/messages\/([^/]+)/)
  if (fullMatch) {
    chatId = fullMatch[1]
    messageId = fullMatch[2]
  }

  if (!chatId || !messageId) {
    const quotedMatch = resource.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (quotedMatch) {
      chatId = quotedMatch[1]
      messageId = quotedMatch[2]
    }
  }

  if (!chatId || !messageId) {
    const collectionMatch = resource.match(/chats\/([^/]+)\/messages$/)
    const rdId = body?.value?.[0]?.resourceData?.id
    if (collectionMatch && rdId) {
      chatId = collectionMatch[1]
      messageId = rdId
    }
  }

  if ((!chatId || !messageId) && body?.value?.[0]?.resourceData?.['@odata.id']) {
    const odataId = String(body.value[0].resourceData['@odata.id'])
    const odataMatch = odataId.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (odataMatch) {
      chatId = odataMatch[1]
      messageId = odataMatch[2]
    }
  }

  if (!chatId || !messageId) {
    logger.warn('Could not resolve chatId/messageId from Teams notification', {
      resource,
      hasResourceDataId: Boolean(body?.value?.[0]?.resourceData?.id),
      valueLength: Array.isArray(body?.value) ? body.value.length : 0,
      keys: Object.keys(body || {}),
    })
    return {
      from: null,
      message: { raw: body },
      activity: body,
      conversation: null,
    }
  }
  const resolvedChatId = chatId as string
  const resolvedMessageId = messageId as string
  const providerConfig = (foundWebhook?.providerConfig as Record<string, any>) || {}
  const credentialId = providerConfig.credentialId
  const includeAttachments = providerConfig.includeAttachments !== false

  let message: any = null
  const rawAttachments: Array<{ name: string; data: Buffer; contentType: string; size: number }> =
    []
  let accessToken: string | null = null

  if (!credentialId) {
    logger.error('Missing credentialId for Teams chat subscription', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      webhookId: foundWebhook?.id,
      blockId: foundWebhook?.blockId,
      providerConfig,
    })
  } else {
    try {
      const resolved = await resolveOAuthAccountId(credentialId)
      if (!resolved) {
        logger.error('Teams credential could not be resolved', { credentialId })
      } else {
        const rows = await db
          .select()
          .from(account)
          .where(eq(account.id, resolved.accountId))
          .limit(1)
        if (rows.length === 0) {
          logger.error('Teams credential not found', { credentialId, chatId: resolvedChatId })
        } else {
          const effectiveUserId = rows[0].userId
          accessToken = await refreshAccessTokenIfNeeded(
            resolved.accountId,
            effectiveUserId,
            'teams-graph-notification'
          )
        }
      }

      if (accessToken) {
        const msgUrl = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(resolvedChatId)}/messages/${encodeURIComponent(resolvedMessageId)}`
        const res = await fetch(msgUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (res.ok) {
          message = await res.json()

          if (includeAttachments && message?.attachments?.length > 0) {
            const attachments = Array.isArray(message?.attachments) ? message.attachments : []
            for (const att of attachments) {
              try {
                const contentUrl =
                  typeof att?.contentUrl === 'string' ? (att.contentUrl as string) : undefined
                const contentTypeHint =
                  typeof att?.contentType === 'string' ? (att.contentType as string) : undefined
                let attachmentName = (att?.name as string) || 'teams-attachment'

                if (!contentUrl) continue

                let buffer: Buffer | null = null
                let mimeType = 'application/octet-stream'

                if (contentUrl.includes('sharepoint.com') || contentUrl.includes('onedrive')) {
                  try {
                    const directRes = await fetchWithDNSPinning(
                      contentUrl,
                      accessToken,
                      'teams-attachment'
                    )

                    if (directRes?.ok) {
                      const arrayBuffer = await directRes.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        directRes.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    } else if (directRes) {
                      const encodedUrl = Buffer.from(contentUrl)
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')

                      const graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${encodedUrl}/driveItem/content`
                      const graphRes = await fetch(graphUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (graphRes.ok) {
                        const arrayBuffer = await graphRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          graphRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else if (
                  contentUrl.includes('1drv.ms') ||
                  contentUrl.includes('onedrive.live.com') ||
                  contentUrl.includes('onedrive.com') ||
                  contentUrl.includes('my.microsoftpersonalcontent.com')
                ) {
                  try {
                    let shareToken: string | null = null

                    if (contentUrl.includes('1drv.ms')) {
                      const urlParts = contentUrl.split('/').pop()
                      if (urlParts) shareToken = urlParts
                    } else if (contentUrl.includes('resid=')) {
                      const urlParams = new URL(contentUrl).searchParams
                      const resId = urlParams.get('resid')
                      if (resId) shareToken = resId
                    }

                    if (!shareToken) {
                      const base64Url = Buffer.from(contentUrl, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    } else if (!shareToken.startsWith('u!')) {
                      const base64Url = Buffer.from(shareToken, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    }

                    const metadataUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem`
                    const metadataRes = await fetch(metadataUrl, {
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/json',
                      },
                    })

                    if (!metadataRes.ok) {
                      const directUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/content`
                      const directRes = await fetch(directUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (directRes.ok) {
                        const arrayBuffer = await directRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          directRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    } else {
                      const metadata = await metadataRes.json()
                      const downloadUrl = metadata['@microsoft.graph.downloadUrl']

                      if (downloadUrl) {
                        const downloadRes = await fetchWithDNSPinning(
                          downloadUrl,
                          '', // downloadUrl is a pre-signed URL, no auth needed
                          'teams-onedrive-download'
                        )

                        if (downloadRes?.ok) {
                          const arrayBuffer = await downloadRes.arrayBuffer()
                          buffer = Buffer.from(arrayBuffer)
                          mimeType =
                            downloadRes.headers.get('content-type') ||
                            metadata.file?.mimeType ||
                            contentTypeHint ||
                            'application/octet-stream'

                          if (metadata.name && metadata.name !== attachmentName) {
                            attachmentName = metadata.name
                          }
                        } else {
                          continue
                        }
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else {
                  try {
                    const ares = await fetchWithDNSPinning(
                      contentUrl,
                      accessToken,
                      'teams-attachment-generic'
                    )
                    if (ares?.ok) {
                      const arrayBuffer = await ares.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        ares.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    }
                  } catch {
                    continue
                  }
                }

                if (!buffer) continue

                const size = buffer.length

                // Store raw attachment (will be uploaded to execution storage later)
                rawAttachments.push({
                  name: attachmentName,
                  data: buffer,
                  contentType: mimeType,
                  size,
                })
              } catch {}
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Teams message', {
        error,
        chatId: resolvedChatId,
        messageId: resolvedMessageId,
      })
    }
  }

  if (!message) {
    logger.warn('No message data available for Teams notification', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      hasCredential: !!credentialId,
    })
    return {
      message_id: resolvedMessageId,
      chat_id: resolvedChatId,
      from_name: '',
      text: '',
      created_at: '',
      attachments: [],
    }
  }

  const messageText = message.body?.content || ''
  const from = message.from?.user || {}
  const createdAt = message.createdDateTime || ''

  return {
    message_id: resolvedMessageId,
    chat_id: resolvedChatId,
    from_name: from.displayName || '',
    text: messageText,
    created_at: createdAt,
    attachments: rawAttachments,
  }
}

const SLACK_MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const SLACK_MAX_FILES = 15

/**
 * Resolves the full file object from the Slack API when the event payload
 * only contains a partial file (e.g. missing url_private due to file_access restrictions).
 * @see https://docs.slack.dev/reference/methods/files.info
 */
async function resolveSlackFileInfo(
  fileId: string,
  botToken: string
): Promise<{ url_private?: string; name?: string; mimetype?: string; size?: number } | null> {
  try {
    const response = await fetch(
      `https://slack.com/api/files.info?file=${encodeURIComponent(fileId)}`,
      {
        headers: { Authorization: `Bearer ${botToken}` },
      }
    )

    const data = (await response.json()) as {
      ok: boolean
      error?: string
      file?: Record<string, any>
    }

    if (!data.ok || !data.file) {
      logger.warn('Slack files.info failed', { fileId, error: data.error })
      return null
    }

    return {
      url_private: data.file.url_private,
      name: data.file.name,
      mimetype: data.file.mimetype,
      size: data.file.size,
    }
  } catch (error) {
    logger.error('Error calling Slack files.info', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Downloads file attachments from Slack using the bot token.
 * Returns files in the format expected by WebhookAttachmentProcessor:
 * { name, data (base64 string), mimeType, size }
 *
 * When the event payload contains partial file objects (missing url_private),
 * falls back to the Slack files.info API to resolve the full file metadata.
 *
 * Security:
 * - Uses validateUrlWithDNS + secureFetchWithPinnedIP to prevent SSRF
 * - Enforces per-file size limit and max file count
 */
async function downloadSlackFiles(
  rawFiles: any[],
  botToken: string
): Promise<Array<{ name: string; data: string; mimeType: string; size: number }>> {
  const filesToProcess = rawFiles.slice(0, SLACK_MAX_FILES)
  const downloaded: Array<{ name: string; data: string; mimeType: string; size: number }> = []

  for (const file of filesToProcess) {
    let urlPrivate = file.url_private as string | undefined
    let fileName = file.name as string | undefined
    let fileMimeType = file.mimetype as string | undefined
    let fileSize = file.size as number | undefined

    // If url_private is missing, resolve via files.info API
    if (!urlPrivate && file.id) {
      const resolved = await resolveSlackFileInfo(file.id, botToken)
      if (resolved?.url_private) {
        urlPrivate = resolved.url_private
        fileName = fileName || resolved.name
        fileMimeType = fileMimeType || resolved.mimetype
        fileSize = fileSize ?? resolved.size
      }
    }

    if (!urlPrivate) {
      logger.warn('Slack file has no url_private and could not be resolved, skipping', {
        fileId: file.id,
      })
      continue
    }

    // Skip files that exceed the size limit
    const reportedSize = Number(fileSize) || 0
    if (reportedSize > SLACK_MAX_FILE_SIZE) {
      logger.warn('Slack file exceeds size limit, skipping', {
        fileId: file.id,
        size: reportedSize,
        limit: SLACK_MAX_FILE_SIZE,
      })
      continue
    }

    try {
      const urlValidation = await validateUrlWithDNS(urlPrivate, 'url_private')
      if (!urlValidation.isValid) {
        logger.warn('Slack file url_private failed DNS validation, skipping', {
          fileId: file.id,
          error: urlValidation.error,
        })
        continue
      }

      const response = await secureFetchWithPinnedIP(urlPrivate, urlValidation.resolvedIP!, {
        headers: { Authorization: `Bearer ${botToken}` },
      })

      if (!response.ok) {
        logger.warn('Failed to download Slack file, skipping', {
          fileId: file.id,
          status: response.status,
        })
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Verify the actual downloaded size doesn't exceed our limit
      if (buffer.length > SLACK_MAX_FILE_SIZE) {
        logger.warn('Downloaded Slack file exceeds size limit, skipping', {
          fileId: file.id,
          actualSize: buffer.length,
          limit: SLACK_MAX_FILE_SIZE,
        })
        continue
      }

      downloaded.push({
        name: fileName || 'download',
        data: buffer.toString('base64'),
        mimeType: fileMimeType || 'application/octet-stream',
        size: buffer.length,
      })
    } catch (error) {
      logger.error('Error downloading Slack file, skipping', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return downloaded
}

const SLACK_REACTION_EVENTS = new Set(['reaction_added', 'reaction_removed'])

/**
 * Fetches the text of a reacted-to message from Slack using the reactions.get API.
 * Unlike conversations.history, reactions.get works for both top-level messages and
 * thread replies, since it looks up the item directly by channel + timestamp.
 * Requires the bot token to have the reactions:read scope.
 */
async function fetchSlackMessageText(
  channel: string,
  messageTs: string,
  botToken: string
): Promise<string> {
  try {
    const params = new URLSearchParams({
      channel,
      timestamp: messageTs,
    })
    const response = await fetch(`https://slack.com/api/reactions.get?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })

    const data = (await response.json()) as {
      ok: boolean
      error?: string
      type?: string
      message?: { text?: string }
    }

    if (!data.ok) {
      logger.warn('Slack reactions.get failed — message text unavailable', {
        channel,
        messageTs,
        error: data.error,
      })
      return ''
    }

    return data.message?.text ?? ''
  } catch (error) {
    logger.warn('Error fetching Slack message text', {
      channel,
      messageTs,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

/**
 * Format webhook input based on provider
 */
export async function formatWebhookInput(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest
): Promise<any> {
  if (foundWebhook.provider === 'whatsapp') {
    const data = body?.entry?.[0]?.changes?.[0]?.value
    const messages = data?.messages || []

    if (messages.length > 0) {
      const message = messages[0]
      return {
        messageId: message.id,
        from: message.from,
        phoneNumberId: data.metadata?.phone_number_id,
        text: message.text?.body,
        timestamp: message.timestamp,
        raw: JSON.stringify(message),
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    const rawMessage =
      body?.message || body?.edited_message || body?.channel_post || body?.edited_channel_post

    const updateType = body.message
      ? 'message'
      : body.edited_message
        ? 'edited_message'
        : body.channel_post
          ? 'channel_post'
          : body.edited_channel_post
            ? 'edited_channel_post'
            : 'unknown'

    if (rawMessage) {
      const messageType = rawMessage.photo
        ? 'photo'
        : rawMessage.document
          ? 'document'
          : rawMessage.audio
            ? 'audio'
            : rawMessage.video
              ? 'video'
              : rawMessage.voice
                ? 'voice'
                : rawMessage.sticker
                  ? 'sticker'
                  : rawMessage.location
                    ? 'location'
                    : rawMessage.contact
                      ? 'contact'
                      : rawMessage.poll
                        ? 'poll'
                        : 'text'

      return {
        message: {
          id: rawMessage.message_id,
          text: rawMessage.text,
          date: rawMessage.date,
          messageType,
          raw: rawMessage,
        },
        sender: rawMessage.from
          ? {
              id: rawMessage.from.id,
              username: rawMessage.from.username,
              firstName: rawMessage.from.first_name,
              lastName: rawMessage.from.last_name,
              languageCode: rawMessage.from.language_code,
              isBot: rawMessage.from.is_bot,
            }
          : null,
        updateId: body.update_id,
        updateType,
      }
    }

    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      updateId: body.update_id,
      updateType,
    }
  }

  if (foundWebhook.provider === 'twilio_voice') {
    return {
      callSid: body.CallSid,
      accountSid: body.AccountSid,
      from: body.From,
      to: body.To,
      callStatus: body.CallStatus,
      direction: body.Direction,
      apiVersion: body.ApiVersion,
      callerName: body.CallerName,
      forwardedFrom: body.ForwardedFrom,
      digits: body.Digits,
      speechResult: body.SpeechResult,
      recordingUrl: body.RecordingUrl,
      recordingSid: body.RecordingSid,
      called: body.Called,
      caller: body.Caller,
      toCity: body.ToCity,
      toState: body.ToState,
      toZip: body.ToZip,
      toCountry: body.ToCountry,
      fromCity: body.FromCity,
      fromState: body.FromState,
      fromZip: body.FromZip,
      fromCountry: body.FromCountry,
      calledCity: body.CalledCity,
      calledState: body.CalledState,
      calledZip: body.CalledZip,
      calledCountry: body.CalledCountry,
      callerCity: body.CallerCity,
      callerState: body.CallerState,
      callerZip: body.CallerZip,
      callerCountry: body.CallerCountry,
      callToken: body.CallToken,
      raw: JSON.stringify(body),
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return {
        email: body.email,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'outlook') {
    if (body && typeof body === 'object' && 'email' in body) {
      return {
        email: body.email,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'rss') {
    if (body && typeof body === 'object' && 'item' in body) {
      return {
        title: body.title,
        link: body.link,
        pubDate: body.pubDate,
        item: body.item,
        feed: body.feed,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'imap') {
    if (body && typeof body === 'object' && 'email' in body) {
      return {
        messageId: body.messageId,
        subject: body.subject,
        from: body.from,
        to: body.to,
        cc: body.cc,
        date: body.date,
        bodyText: body.bodyText,
        bodyHtml: body.bodyHtml,
        mailbox: body.mailbox,
        hasAttachments: body.hasAttachments,
        attachments: body.attachments,
        email: body.email,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'hubspot') {
    const events = Array.isArray(body) ? body : [body]
    const event = events[0]

    if (!event) {
      logger.warn('HubSpot webhook received with empty payload')
      return null
    }

    logger.info('Formatting HubSpot webhook input', {
      subscriptionType: event.subscriptionType,
      objectId: event.objectId,
      portalId: event.portalId,
    })

    return {
      payload: body,
      provider: 'hubspot',
      providerConfig: foundWebhook.providerConfig,
    }
  }

  if (foundWebhook.provider === 'microsoft-teams') {
    if (body?.value && Array.isArray(body.value) && body.value.length > 0) {
      return await formatTeamsGraphNotification(body, foundWebhook, foundWorkflow, request)
    }

    const messageText = body?.text || ''
    const messageId = body?.id || ''
    const timestamp = body?.timestamp || body?.localTimestamp || ''
    const from = body?.from || {}
    const conversation = body?.conversation || {}

    const messageObj = {
      raw: {
        attachments: body?.attachments || [],
        channelData: body?.channelData || {},
        conversation: body?.conversation || {},
        text: messageText,
        messageType: body?.type || 'message',
        channelId: body?.channelId || '',
        timestamp,
      },
    }

    const fromObj = {
      id: from.id || '',
      name: from.name || '',
      aadObjectId: from.aadObjectId || '',
    }

    const conversationObj = {
      id: conversation.id || '',
      name: conversation.name || '',
      isGroup: conversation.isGroup || false,
      tenantId: conversation.tenantId || '',
      aadObjectId: conversation.aadObjectId || '',
      conversationType: conversation.conversationType || '',
    }

    const activityObj = body || {}

    return {
      from: fromObj,
      message: messageObj,
      activity: activityObj,
      conversation: conversationObj,
    }
  }

  if (foundWebhook.provider === 'slack') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const botToken = providerConfig.botToken as string | undefined
    const includeFiles = Boolean(providerConfig.includeFiles)

    const rawEvent = body?.event

    if (!rawEvent) {
      logger.warn('Unknown Slack event type', {
        type: body?.type,
        hasEvent: false,
        bodyKeys: Object.keys(body || {}),
      })
    }

    const eventType: string = rawEvent?.type || body?.type || 'unknown'
    const isReactionEvent = SLACK_REACTION_EVENTS.has(eventType)

    // Reaction events nest channel/ts inside event.item
    const channel: string = isReactionEvent
      ? rawEvent?.item?.channel || ''
      : rawEvent?.channel || ''
    const messageTs: string = isReactionEvent
      ? rawEvent?.item?.ts || ''
      : rawEvent?.ts || rawEvent?.event_ts || ''

    // For reaction events, attempt to fetch the original message text
    let text: string = rawEvent?.text || ''
    if (isReactionEvent && channel && messageTs && botToken) {
      text = await fetchSlackMessageText(channel, messageTs, botToken)
    }

    const rawFiles: any[] = rawEvent?.files ?? []
    const hasFiles = rawFiles.length > 0

    let files: any[] = []
    if (hasFiles && includeFiles && botToken) {
      files = await downloadSlackFiles(rawFiles, botToken)
    } else if (hasFiles && includeFiles && !botToken) {
      logger.warn('Slack message has files and includeFiles is enabled, but no bot token provided')
    }

    return {
      event: {
        event_type: eventType,
        channel,
        channel_name: '',
        user: rawEvent?.user || '',
        user_name: '',
        text,
        timestamp: messageTs,
        thread_ts: rawEvent?.thread_ts || '',
        team_id: body?.team_id || rawEvent?.team || '',
        event_id: body?.event_id || '',
        reaction: rawEvent?.reaction || '',
        item_user: rawEvent?.item_user || '',
        hasFiles,
        files,
      },
    }
  }

  if (foundWebhook.provider === 'webflow') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    // Form submission trigger
    if (triggerId === 'webflow_form_submission') {
      return {
        siteId: body?.siteId || '',
        formId: body?.formId || '',
        name: body?.name || '',
        id: body?.id || '',
        submittedAt: body?.submittedAt || '',
        data: body?.data || {},
        schema: body?.schema || {},
        formElementId: body?.formElementId || '',
      }
    }

    // Collection item triggers (created, changed, deleted)
    // Webflow uses _cid for collection ID and _id for item ID
    const { _cid, _id, ...itemFields } = body || {}
    return {
      siteId: body?.siteId || '',
      collectionId: _cid || body?.collectionId || '',
      payload: {
        id: _id || '',
        cmsLocaleId: itemFields?.cmsLocaleId || '',
        lastPublished: itemFields?.lastPublished || itemFields?.['last-published'] || '',
        lastUpdated: itemFields?.lastUpdated || itemFields?.['last-updated'] || '',
        createdOn: itemFields?.createdOn || itemFields?.['created-on'] || '',
        isArchived: itemFields?.isArchived || itemFields?._archived || false,
        isDraft: itemFields?.isDraft || itemFields?._draft || false,
        fieldData: itemFields,
      },
    }
  }

  if (foundWebhook.provider === 'generic') {
    return body
  }

  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    const normalizeAnswers = (src: unknown): Record<string, unknown> => {
      if (!src || typeof src !== 'object') return {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          out[k] = v.length === 1 ? v[0] : v
        } else {
          out[k] = v as unknown
        }
      }
      return out
    }

    const responseId = body?.responseId || body?.id || ''
    const createTime = body?.createTime || body?.timestamp || new Date().toISOString()
    const lastSubmittedTime = body?.lastSubmittedTime || createTime
    const formId = body?.formId || providerConfig.formId || ''
    const includeRaw = providerConfig.includeRawPayload !== false

    return {
      responseId,
      createTime,
      lastSubmittedTime,
      formId,
      answers: normalizeAnswers(body?.answers),
      ...(includeRaw ? { raw: body?.raw ?? body } : {}),
    }
  }

  if (foundWebhook.provider === 'github') {
    const eventType = request.headers.get('x-github-event') || 'unknown'
    const branch = body?.ref?.replace('refs/heads/', '') || ''

    return {
      ...body,
      event_type: eventType,
      action: body?.action || '',
      branch,
    }
  }

  if (foundWebhook.provider === 'typeform') {
    const formResponse = body?.form_response || {}
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const includeDefinition = providerConfig.includeDefinition === true

    return {
      event_id: body?.event_id || '',
      event_type: body?.event_type || 'form_response',
      form_id: formResponse.form_id || '',
      token: formResponse.token || '',
      submitted_at: formResponse.submitted_at || '',
      landed_at: formResponse.landed_at || '',
      calculated: formResponse.calculated || {},
      variables: formResponse.variables || [],
      hidden: formResponse.hidden || {},
      answers: formResponse.answers || [],
      ...(includeDefinition ? { definition: formResponse.definition || {} } : {}),
      ending: formResponse.ending || {},
      raw: body,
    }
  }

  if (foundWebhook.provider === 'linear') {
    return {
      action: body.action || '',
      type: body.type || '',
      webhookId: body.webhookId || '',
      webhookTimestamp: body.webhookTimestamp || 0,
      organizationId: body.organizationId || '',
      createdAt: body.createdAt || '',
      actor: body.actor || null,
      data: body.data || null,
      updatedFrom: body.updatedFrom || null,
    }
  }

  if (foundWebhook.provider === 'jira') {
    const { extractIssueData, extractCommentData, extractWorklogData } = await import(
      '@/triggers/jira/utils'
    )

    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'jira_issue_commented') {
      return extractCommentData(body)
    }
    if (triggerId === 'jira_worklog_created') {
      return extractWorklogData(body)
    }
    return extractIssueData(body)
  }

  if (foundWebhook.provider === 'confluence') {
    const {
      extractPageData,
      extractCommentData,
      extractBlogData,
      extractAttachmentData,
      extractSpaceData,
      extractLabelData,
    } = await import('@/triggers/confluence/utils')

    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId?.startsWith('confluence_comment_')) {
      return extractCommentData(body)
    }
    if (triggerId?.startsWith('confluence_blog_')) {
      return extractBlogData(body)
    }
    if (triggerId?.startsWith('confluence_attachment_')) {
      return extractAttachmentData(body)
    }
    if (triggerId?.startsWith('confluence_space_')) {
      return extractSpaceData(body)
    }
    if (triggerId?.startsWith('confluence_label_')) {
      return extractLabelData(body)
    }
    // Generic webhook — preserve all entity fields since event type varies
    if (triggerId === 'confluence_webhook') {
      return {
        timestamp: body.timestamp,
        userAccountId: body.userAccountId,
        accountType: body.accountType,
        page: body.page || null,
        comment: body.comment || null,
        blog: body.blog || body.blogpost || null,
        attachment: body.attachment || null,
        space: body.space || null,
        label: body.label || null,
        content: body.content || null,
      }
    }
    // Default: page events
    return extractPageData(body)
  }

  if (foundWebhook.provider === 'ashby') {
    return {
      ...(body.data || {}),
      action: body.action,
      data: body.data || {},
    }
  }

  if (foundWebhook.provider === 'stripe') {
    return body
  }

  if (foundWebhook.provider === 'calendly') {
    return {
      event: body.event,
      created_at: body.created_at,
      created_by: body.created_by,
      payload: body.payload,
    }
  }

  if (foundWebhook.provider === 'circleback') {
    return {
      id: body.id,
      name: body.name,
      createdAt: body.createdAt,
      duration: body.duration,
      url: body.url,
      recordingUrl: body.recordingUrl,
      tags: body.tags || [],
      icalUid: body.icalUid,
      attendees: body.attendees || [],
      notes: body.notes || '',
      actionItems: body.actionItems || [],
      transcript: body.transcript || [],
      insights: body.insights || {},
      meeting: body,
    }
  }

  if (foundWebhook.provider === 'grain') {
    return {
      type: body.type,
      user_id: body.user_id,
      data: body.data || {},
    }
  }

  if (foundWebhook.provider === 'fireflies') {
    return {
      meetingId: body.meetingId || '',
      eventType: body.eventType || 'Transcription completed',
      clientReferenceId: body.clientReferenceId || '',
    }
  }

  if (foundWebhook.provider === 'attio') {
    const {
      extractAttioRecordData,
      extractAttioRecordUpdatedData,
      extractAttioRecordMergedData,
      extractAttioNoteData,
      extractAttioTaskData,
      extractAttioCommentData,
      extractAttioListEntryData,
      extractAttioListEntryUpdatedData,
      extractAttioListData,
      extractAttioWorkspaceMemberData,
      extractAttioGenericData,
    } = await import('@/triggers/attio/utils')

    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'attio_record_updated') {
      return extractAttioRecordUpdatedData(body)
    }
    if (triggerId === 'attio_record_merged') {
      return extractAttioRecordMergedData(body)
    }
    if (triggerId === 'attio_record_created' || triggerId === 'attio_record_deleted') {
      return extractAttioRecordData(body)
    }
    if (triggerId?.startsWith('attio_note_')) {
      return extractAttioNoteData(body)
    }
    if (triggerId?.startsWith('attio_task_')) {
      return extractAttioTaskData(body)
    }
    if (triggerId?.startsWith('attio_comment_')) {
      return extractAttioCommentData(body)
    }
    if (triggerId === 'attio_list_entry_updated') {
      return extractAttioListEntryUpdatedData(body)
    }
    if (triggerId === 'attio_list_entry_created' || triggerId === 'attio_list_entry_deleted') {
      return extractAttioListEntryData(body)
    }
    if (
      triggerId === 'attio_list_created' ||
      triggerId === 'attio_list_updated' ||
      triggerId === 'attio_list_deleted'
    ) {
      return extractAttioListData(body)
    }
    if (triggerId === 'attio_workspace_member_created') {
      return extractAttioWorkspaceMemberData(body)
    }
    return extractAttioGenericData(body)
  }

  return body
}


/**
 * Result of syncing webhooks for a credential set
 */
export interface CredentialSetWebhookSyncResult {
  webhooks: Array<{
    id: string
    credentialId: string
    isNew: boolean
  }>
  created: number
  updated: number
  deleted: number
  failed: Array<{
    credentialId: string
    error: string
  }>
}

/**
 * Sync webhooks for a credential set.
 *
 * For credential sets, we create one webhook per credential in the set.
 * Each webhook has its own state and credentialId.
 *
 * Path strategy:
 * - Polling triggers (gmail, outlook): unique paths per credential (for independent polling)
 * - External triggers (slack, etc.): shared path (external service sends to one URL)
 *
 * This function:
 * 1. Gets all credentials in the credential set
 * 2. Gets existing webhooks for this workflow+block with this credentialSetId
 * 3. Creates webhooks for new credentials
 * 4. Updates config for existing webhooks (preserving state)
 * 5. Deletes webhooks for credentials no longer in the set
 */
export async function syncWebhooksForCredentialSet(params: {
  workflowId: string
  blockId: string
  provider: string
  basePath: string
  credentialSetId: string
  oauthProviderId: string
  providerConfig: Record<string, any>
  requestId: string
  tx?: DbOrTx
  deploymentVersionId?: string
}): Promise<CredentialSetWebhookSyncResult> {
  const {
    workflowId,
    blockId,
    provider,
    basePath,
    credentialSetId,
    oauthProviderId,
    providerConfig,
    requestId,
    tx,
    deploymentVersionId,
  } = params

  const dbCtx = tx ?? db

  const syncLogger = createLogger('CredentialSetWebhookSync')
  syncLogger.info(
    `[${requestId}] Syncing webhooks for credential set ${credentialSetId}, provider ${provider}`
  )

  const useUniquePaths = isPollingWebhookProvider(provider)

  const credentials = await getCredentialsForCredentialSet(credentialSetId, oauthProviderId)

  if (credentials.length === 0) {
    syncLogger.warn(
      `[${requestId}] No credentials found in credential set ${credentialSetId} for provider ${oauthProviderId}`
    )
    return { webhooks: [], created: 0, updated: 0, deleted: 0, failed: [] }
  }

  syncLogger.info(
    `[${requestId}] Found ${credentials.length} credentials in set ${credentialSetId}`
  )

  // Get existing webhooks for this workflow+block that belong to this credential set
  const existingWebhooks = await dbCtx
    .select()
    .from(webhook)
    .where(
      deploymentVersionId
        ? and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            eq(webhook.deploymentVersionId, deploymentVersionId),
            isNull(webhook.archivedAt)
          )
        : and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            isNull(webhook.archivedAt)
          )
    )

  // Filter to only webhooks belonging to this credential set
  const credentialSetWebhooks = existingWebhooks.filter(
    (wh) => wh.credentialSetId === credentialSetId
  )

  syncLogger.info(
    `[${requestId}] Found ${credentialSetWebhooks.length} existing webhooks for credential set`
  )

  // Build maps for efficient lookup
  const existingByCredentialId = new Map<string, (typeof credentialSetWebhooks)[number]>()
  for (const wh of credentialSetWebhooks) {
    const config = wh.providerConfig as Record<string, any>
    if (config?.credentialId) {
      existingByCredentialId.set(config.credentialId, wh)
    }
  }

  const credentialIdsInSet = new Set(credentials.map((c) => c.credentialId))
  const [workflowRecord] = await db
    .select({
      id: workflow.id,
      userId: workflow.userId,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  const result: CredentialSetWebhookSyncResult = {
    webhooks: [],
    created: 0,
    updated: 0,
    deleted: 0,
    failed: [],
  }

  // Process each credential in the set
  for (const cred of credentials) {
    try {
      const existingWebhook = existingByCredentialId.get(cred.credentialId)

      if (existingWebhook) {
        // Update existing webhook - preserve state fields
        const existingConfig = existingWebhook.providerConfig as Record<string, any>

        const updatedConfig = {
          ...providerConfig,
          basePath, // Store basePath for reliable reconstruction during membership sync
          credentialId: cred.credentialId,
          credentialSetId: credentialSetId,
          // Preserve state fields from existing config
          historyId: existingConfig?.historyId,
          lastCheckedTimestamp: existingConfig?.lastCheckedTimestamp,
          setupCompleted: existingConfig?.setupCompleted,
          externalId: existingConfig?.externalId,
          userId: cred.userId,
        }

        await dbCtx
          .update(webhook)
          .set({
            ...(deploymentVersionId ? { deploymentVersionId } : {}),
            providerConfig: updatedConfig,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, existingWebhook.id))

        result.webhooks.push({
          id: existingWebhook.id,
          credentialId: cred.credentialId,
          isNew: false,
        })
        result.updated++

        syncLogger.debug(
          `[${requestId}] Updated webhook ${existingWebhook.id} for credential ${cred.credentialId}`
        )
      } else {
        // Create new webhook for this credential
        const webhookId = generateShortId()
        const webhookPath = useUniquePaths
          ? `${basePath}-${cred.credentialId.slice(0, 8)}`
          : basePath

        const newConfig = {
          ...providerConfig,
          basePath, // Store basePath for reliable reconstruction during membership sync
          credentialId: cred.credentialId,
          credentialSetId: credentialSetId,
          userId: cred.userId,
        }

        await dbCtx.insert(webhook).values({
          id: webhookId,
          workflowId,
          blockId,
          path: webhookPath,
          provider,
          providerConfig: newConfig,
          credentialSetId, // Indexed column for efficient credential set queries
          isActive: true,
          ...(deploymentVersionId ? { deploymentVersionId } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        result.webhooks.push({
          id: webhookId,
          credentialId: cred.credentialId,
          isNew: true,
        })
        result.created++

        syncLogger.debug(
          `[${requestId}] Created webhook ${webhookId} for credential ${cred.credentialId}`
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      syncLogger.error(
        `[${requestId}] Failed to sync webhook for credential ${cred.credentialId}: ${errorMessage}`
      )
      result.failed.push({
        credentialId: cred.credentialId,
        error: errorMessage,
      })
    }
  }

  // Delete webhooks for credentials no longer in the set
  for (const [credentialId, existingWebhook] of existingByCredentialId) {
    if (!credentialIdsInSet.has(credentialId)) {
      try {
        if (workflowRecord) {
          await cleanupExternalWebhook(existingWebhook, workflowRecord, requestId)
        }
        await dbCtx.delete(webhook).where(eq(webhook.id, existingWebhook.id))
        result.deleted++

        syncLogger.debug(
          `[${requestId}] Deleted webhook ${existingWebhook.id} for removed credential ${credentialId}`
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        syncLogger.error(
          `[${requestId}] Failed to delete webhook ${existingWebhook.id} for credential ${credentialId}: ${errorMessage}`
        )
        result.failed.push({
          credentialId,
          error: `Failed to delete: ${errorMessage}`,
        })
      }
    }
  }

  syncLogger.info(
    `[${requestId}] Credential set webhook sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.failed.length} failed`
  )

  return result
}

/**
 * Sync all webhooks that use a specific credential set.
 * Called when credential set membership changes (member added/removed).
 *
 * This finds all workflows with webhooks using this credential set and resyncs them.
 */
export async function syncAllWebhooksForCredentialSet(
  credentialSetId: string,
  requestId: string,
  tx?: DbOrTx
): Promise<{ workflowsUpdated: number; totalCreated: number; totalDeleted: number }> {
  const dbCtx = tx ?? db
  const syncLogger = createLogger('CredentialSetMembershipSync')
  syncLogger.info(`[${requestId}] Syncing all webhooks for credential set ${credentialSetId}`)

  // Find all webhooks that use this credential set using the indexed column
  const webhooksForSet = await dbCtx
    .select({ webhook })
    .from(webhook)
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.credentialSetId, credentialSetId),
        isNull(webhook.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  if (webhooksForSet.length === 0) {
    syncLogger.info(`[${requestId}] No webhooks found using credential set ${credentialSetId}`)
    return { workflowsUpdated: 0, totalCreated: 0, totalDeleted: 0 }
  }

  // Group webhooks by workflow+block to find unique triggers
  const triggerGroups = new Map<string, (typeof webhooksForSet)[number]['webhook']>()
  for (const row of webhooksForSet) {
    const wh = row.webhook
    const key = `${wh.workflowId}:${wh.blockId}`
    // Keep the first webhook as representative (they all have same config)
    if (!triggerGroups.has(key)) {
      triggerGroups.set(key, wh)
    }
  }

  syncLogger.info(
    `[${requestId}] Found ${triggerGroups.size} triggers using credential set ${credentialSetId}`
  )

  let workflowsUpdated = 0
  let totalCreated = 0
  let totalDeleted = 0

  for (const [key, representativeWebhook] of triggerGroups) {
    if (!representativeWebhook.provider) {
      syncLogger.warn(`[${requestId}] Skipping webhook without provider: ${key}`)
      continue
    }

    const config = representativeWebhook.providerConfig as Record<string, any>
    const oauthProviderId = getProviderIdFromServiceId(representativeWebhook.provider)

    const { credentialId: _cId, userId: _uId, basePath: _bp, ...baseConfig } = config
    // Use stored basePath if available, otherwise fall back to blockId (for legacy webhooks)
    const basePath = config.basePath || representativeWebhook.blockId || representativeWebhook.path

    try {
      const result = await syncWebhooksForCredentialSet({
        workflowId: representativeWebhook.workflowId,
        blockId: representativeWebhook.blockId || '',
        provider: representativeWebhook.provider,
        basePath,
        credentialSetId,
        oauthProviderId,
        providerConfig: baseConfig,
        requestId,
        tx: dbCtx,
        deploymentVersionId: representativeWebhook.deploymentVersionId || undefined,
      })

      workflowsUpdated++
      totalCreated += result.created
      totalDeleted += result.deleted

      syncLogger.debug(
        `[${requestId}] Synced webhooks for ${key}: ${result.created} created, ${result.deleted} deleted`
      )
    } catch (error) {
      syncLogger.error(`[${requestId}] Error syncing webhooks for ${key}`, error)
    }
  }

  syncLogger.info(
    `[${requestId}] Credential set membership sync complete: ${workflowsUpdated} workflows updated, ${totalCreated} webhooks created, ${totalDeleted} webhooks deleted`
  )

  return { workflowsUpdated, totalCreated, totalDeleted }
}

/**
 * Configure Gmail polling for a webhook.
 * Each webhook has its own credentialId (credential sets are fanned out at save time).
 */
export async function configureGmailPolling(webhookData: any, requestId: string): Promise<boolean> {
  const logger = createLogger('GmailWebhookSetup')
  logger.info(`[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId for Gmail webhook ${webhookData.id}`)
      return false
    }

    const resolvedGmail = await resolveOAuthAccountId(credentialId)
    if (!resolvedGmail) {
      logger.error(
        `[${requestId}] Could not resolve credential ${credentialId} for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const rows = await db
      .select()
      .from(account)
      .where(eq(account.id, resolvedGmail.accountId))
      .limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    const accessToken = await refreshAccessTokenIfNeeded(
      resolvedGmail.accountId,
      effectiveUserId,
      requestId
    )
    if (!accessToken) {
      logger.error(
        `[${requestId}] Failed to refresh/access Gmail token for credential ${credentialId}`
      )
      return false
    }

    const maxEmailsPerPoll =
      typeof providerConfig.maxEmailsPerPoll === 'string'
        ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
        : providerConfig.maxEmailsPerPoll || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
        : providerConfig.pollingInterval || 5

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId: effectiveUserId,
          credentialId,
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: providerConfig.lastCheckedTimestamp || now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Gmail polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}

/**
 * Configure Outlook polling for a webhook.
 * Each webhook has its own credentialId (credential sets are fanned out at save time).
 */
export async function configureOutlookPolling(
  webhookData: any,
  requestId: string
): Promise<boolean> {
  const logger = createLogger('OutlookWebhookSetup')
  logger.info(`[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId for Outlook webhook ${webhookData.id}`)
      return false
    }

    const resolvedOutlook = await resolveOAuthAccountId(credentialId)
    if (!resolvedOutlook) {
      logger.error(
        `[${requestId}] Could not resolve credential ${credentialId} for Outlook webhook ${webhookData.id}`
      )
      return false
    }

    const rows = await db
      .select()
      .from(account)
      .where(eq(account.id, resolvedOutlook.accountId))
      .limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Outlook webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    const accessToken = await refreshAccessTokenIfNeeded(
      resolvedOutlook.accountId,
      effectiveUserId,
      requestId
    )
    if (!accessToken) {
      logger.error(
        `[${requestId}] Failed to refresh/access Outlook token for credential ${credentialId}`
      )
      return false
    }

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId: effectiveUserId,
          credentialId,
          maxEmailsPerPoll:
            typeof providerConfig.maxEmailsPerPoll === 'string'
              ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
              : providerConfig.maxEmailsPerPoll || 25,
          pollingInterval:
            typeof providerConfig.pollingInterval === 'string'
              ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
              : providerConfig.pollingInterval || 5,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          folderIds: providerConfig.folderIds || ['inbox'],
          folderFilterBehavior: providerConfig.folderFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: providerConfig.lastCheckedTimestamp || now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Outlook polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Outlook polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}

/**
 * Configure RSS polling for a webhook
 */
export async function configureRssPolling(webhookData: any, requestId: string): Promise<boolean> {
  const logger = createLogger('RssWebhookSetup')
  logger.info(`[${requestId}] Setting up RSS polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          lastCheckedTimestamp: now.toISOString(),
          lastSeenGuids: [],
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(`[${requestId}] Successfully configured RSS polling for webhook ${webhookData.id}`)
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure RSS polling`, {
      webhookId: webhookData.id,
      error: error.message,
    })
    return false
  }
}

/**
 * Configure IMAP polling for a webhook
 */
export async function configureImapPolling(webhookData: any, requestId: string): Promise<boolean> {
  const logger = createLogger('ImapWebhookSetup')
  logger.info(`[${requestId}] Setting up IMAP polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const now = new Date()

    if (!providerConfig.host || !providerConfig.username || !providerConfig.password) {
      logger.error(
        `[${requestId}] Missing required IMAP connection settings for webhook ${webhookData.id}`
      )
      return false
    }

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          port: providerConfig.port || '993',
          secure: providerConfig.secure !== false,
          mailbox: providerConfig.mailbox || 'INBOX',
          searchCriteria: providerConfig.searchCriteria || 'UNSEEN',
          markAsRead: providerConfig.markAsRead || false,
          includeAttachments: providerConfig.includeAttachments !== false,
          lastCheckedTimestamp: now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(`[${requestId}] Successfully configured IMAP polling for webhook ${webhookData.id}`)
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure IMAP polling`, {
      webhookId: webhookData.id,
      error: error.message,
    })
    return false
  }
}

export function convertSquareBracketsToTwiML(twiml: string | undefined): string | undefined {
  if (!twiml) {
    return twiml
  }

  // Replace [Tag] with <Tag> and [/Tag] with </Tag>
  return twiml.replace(/\[(\/?[^\]]+)\]/g, '<$1>')
}
