import crypto from 'crypto'
import { db, workflowDeploymentVersion } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import type { DbOrTx } from '@/lib/db/types'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import {
  getCredentialsForCredentialSet,
  refreshAccessTokenIfNeeded,
} from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookUtils')

/**
 * Handle WhatsApp verification requests
 */
export async function handleWhatsAppVerification(
  requestId: string,
  path: string,
  mode: string | null,
  token: string | null,
  challenge: string | null
): Promise<NextResponse | null> {
  if (mode && token && challenge) {
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    const webhooks = await db
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
          eq(webhook.provider, 'whatsapp'),
          eq(webhook.isActive, true),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )

    for (const row of webhooks) {
      const wh = row.webhook
      const providerConfig = (wh.providerConfig as Record<string, any>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        return new NextResponse(challenge, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      }
    }

    logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
    return new NextResponse('Verification failed', { status: 403 })
  }

  return null
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(body: any): NextResponse | null {
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }

  return null
}

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
      const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
      if (rows.length === 0) {
        logger.error('Teams credential not found', { credentialId, chatId: resolvedChatId })
      } else {
        const effectiveUserId = rows[0].userId
        accessToken = await refreshAccessTokenIfNeeded(
          credentialId,
          effectiveUserId,
          'teams-graph-notification'
        )
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

export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, any>
): Promise<boolean> {
  try {
    if (!authToken || !signature || !url) {
      logger.warn('Twilio signature validation missing required fields', {
        hasAuthToken: !!authToken,
        hasSignature: !!signature,
        hasUrl: !!url,
      })
      return false
    }

    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }

    logger.debug('Twilio signature validation string built', {
      url,
      sortedKeys,
      dataLength: data.length,
    })

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(data))

    const signatureArray = Array.from(new Uint8Array(signatureBytes))
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray))

    logger.debug('Twilio signature comparison', {
      computedSignature: `${signatureBase64.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: signatureBase64.length,
      providedLength: signature.length,
      match: signatureBase64 === signature,
    })

    return safeCompare(signatureBase64, signature)
  } catch (error) {
    logger.error('Error validating Twilio signature:', error)
    return false
  }
}

const SLACK_FILE_HOSTS = new Set(['files.slack.com', 'files-pri.slack.com'])
const SLACK_MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const SLACK_MAX_FILES = 10

/**
 * Downloads file attachments from Slack using the bot token.
 * Returns files in the format expected by WebhookAttachmentProcessor:
 * { name, data (base64 string), mimeType, size }
 *
 * Security:
 * - Validates each url_private against allowlisted Slack file hosts
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
    const urlPrivate = file.url_private as string | undefined
    if (!urlPrivate) {
      continue
    }

    // Validate the URL points to a known Slack file host
    let parsedUrl: URL
    try {
      parsedUrl = new URL(urlPrivate)
    } catch {
      logger.warn('Slack file has invalid url_private, skipping', { fileId: file.id })
      continue
    }

    if (!SLACK_FILE_HOSTS.has(parsedUrl.hostname)) {
      logger.warn('Slack file url_private points to unexpected host, skipping', {
        fileId: file.id,
        hostname: sanitizeUrlForLog(urlPrivate),
      })
      continue
    }

    // Skip files that exceed the size limit
    const reportedSize = Number(file.size) || 0
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
        name: file.name || 'download',
        data: buffer.toString('base64'),
        mimeType: file.mimetype || 'application/octet-stream',
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
        event_type: rawEvent?.type || body?.type || 'unknown',
        channel: rawEvent?.channel || '',
        channel_name: '',
        user: rawEvent?.user || '',
        user_name: '',
        text: rawEvent?.text || '',
        timestamp: rawEvent?.ts || rawEvent?.event_ts || '',
        thread_ts: rawEvent?.thread_ts || '',
        team_id: body?.team_id || rawEvent?.team || '',
        event_id: body?.event_id || '',
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

  return body
}

/**
 * Validates a Microsoft Teams outgoing webhook request signature using HMAC SHA-256
 * @param hmacSecret - Microsoft Teams HMAC secret (base64 encoded)
 * @param signature - Authorization header value (should start with 'HMAC ')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateMicrosoftTeamsSignature(
  hmacSecret: string,
  signature: string,
  body: string
): boolean {
  try {
    if (!hmacSecret || !signature || !body) {
      return false
    }

    if (!signature.startsWith('HMAC ')) {
      return false
    }

    const providedSignature = signature.substring(5)

    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Microsoft Teams signature:', error)
    return false
  }
}

/**
 * Validates a Typeform webhook request signature using HMAC SHA-256
 * @param secret - Typeform webhook secret (plain text)
 * @param signature - Typeform-Signature header value (should be in format 'sha256=<signature>')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateTypeformSignature(
  secret: string,
  signature: string,
  body: string
): boolean {
  try {
    if (!secret || !signature || !body) {
      return false
    }

    if (!signature.startsWith('sha256=')) {
      return false
    }

    const providedSignature = signature.substring(7)

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Typeform signature:', error)
    return false
  }
}

/**
 * Validates a Linear webhook request signature using HMAC SHA-256
 * @param secret - Linear webhook secret (plain text)
 * @param signature - Linear-Signature header value (hex-encoded HMAC SHA-256 signature)
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateLinearSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Linear signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Linear signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })

    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
    return false
  }
}

/**
 * Validates a Circleback webhook request signature using HMAC SHA-256
 * @param secret - Circleback signing secret (plain text)
 * @param signature - x-signature header value (hex-encoded HMAC SHA-256 signature)
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateCirclebackSignature(
  secret: string,
  signature: string,
  body: string
): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Circleback signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Circleback signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })

    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Circleback signature:', error)
    return false
  }
}

/**
 * Validates a Jira webhook request signature using HMAC SHA-256
 * @param secret - Jira webhook secret (plain text)
 * @param signature - X-Hub-Signature header value (format: 'sha256=<hex>')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateJiraSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Jira signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    if (!signature.startsWith('sha256=')) {
      logger.warn('Jira signature has invalid format (expected sha256=)', {
        signaturePrefix: signature.substring(0, 10),
      })
      return false
    }

    const providedSignature = signature.substring(7)

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Jira signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Jira signature:', error)
    return false
  }
}

/**
 * Validates a Fireflies webhook request signature using HMAC SHA-256
 * @param secret - Fireflies webhook secret (16-32 characters)
 * @param signature - x-hub-signature header value (format: 'sha256=<hex>')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateFirefliesSignature(
  secret: string,
  signature: string,
  body: string
): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Fireflies signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    if (!signature.startsWith('sha256=')) {
      logger.warn('Fireflies signature has invalid format (expected sha256=)', {
        signaturePrefix: signature.substring(0, 10),
      })
      return false
    }

    const providedSignature = signature.substring(7)

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Fireflies signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Fireflies signature:', error)
    return false
  }
}

/**
 * Validates a GitHub webhook request signature using HMAC SHA-256 or SHA-1
 * @param secret - GitHub webhook secret (plain text)
 * @param signature - X-Hub-Signature-256 or X-Hub-Signature header value (format: 'sha256=<hex>' or 'sha1=<hex>')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateGitHubSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('GitHub signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    let algorithm: 'sha256' | 'sha1'
    let providedSignature: string

    if (signature.startsWith('sha256=')) {
      algorithm = 'sha256'
      providedSignature = signature.substring(7)
    } else if (signature.startsWith('sha1=')) {
      algorithm = 'sha1'
      providedSignature = signature.substring(5)
    } else {
      logger.warn('GitHub signature has invalid format', {
        signature: `${signature.substring(0, 10)}...`,
      })
      return false
    }

    const computedHash = crypto.createHmac(algorithm, secret).update(body, 'utf8').digest('hex')

    logger.debug('GitHub signature comparison', {
      algorithm,
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating GitHub signature:', error)
    return false
  }
}

/**
 * Process webhook provider-specific verification
 */
export function verifyProviderWebhook(
  foundWebhook: any,
  request: NextRequest,
  requestId: string
): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
  switch (foundWebhook.provider) {
    case 'github':
      break
    case 'stripe':
      break
    case 'gmail':
      break
    case 'telegram': {
      // Check User-Agent to ensure it's not blocked by middleware
      const userAgent = request.headers.get('user-agent') || ''
      logger.debug(`[${requestId}] Telegram webhook request received with User-Agent: ${userAgent}`)

      if (!userAgent) {
        logger.warn(
          `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
        )
      }

      // Telegram uses IP addresses in specific ranges
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'

      logger.debug(`[${requestId}] Telegram webhook request from IP: ${clientIp}`)

      break
    }
    case 'microsoft-teams':
      break
    case 'generic':
      if (providerConfig.requireAuth) {
        let isAuthenticated = false
        if (providerConfig.token) {
          const bearerMatch = authHeader?.match(/^bearer\s+(.+)$/i)
          const providedToken = bearerMatch ? bearerMatch[1] : null
          if (providedToken === providerConfig.token) {
            isAuthenticated = true
          }
          if (!isAuthenticated && providerConfig.secretHeaderName) {
            const customHeaderValue = request.headers.get(providerConfig.secretHeaderName)
            if (customHeaderValue === providerConfig.token) {
              isAuthenticated = true
            }
          }
          if (!isAuthenticated) {
            logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
            return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
          }
        }
      }
      if (
        providerConfig.allowedIps &&
        Array.isArray(providerConfig.allowedIps) &&
        providerConfig.allowedIps.length > 0
      ) {
        const clientIp =
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          request.headers.get('x-real-ip') ||
          'unknown'

        if (clientIp === 'unknown' || !providerConfig.allowedIps.includes(clientIp)) {
          logger.warn(
            `[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`
          )
          return new NextResponse('Forbidden - IP not allowed', {
            status: 403,
          })
        }
      }
      break
    default:
      if (providerConfig.token) {
        const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
        if (!providedToken || providedToken !== providerConfig.token) {
          logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
  }

  return null
}

/**
 * Process Airtable payloads
 */
export async function fetchAndProcessAirtablePayloads(
  webhookData: any,
  workflowData: any,
  requestId: string // Original request ID from the ping, used for the final execution log
) {
  // Logging handles all error logging
  let currentCursor: number | null = null
  let mightHaveMore = true
  let payloadsFetched = 0
  let apiCallCount = 0
  // Use a Map to consolidate changes per record ID
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  // Capture raw payloads from Airtable for exposure to workflows
  const allPayloads = []
  const localProviderConfig = {
    ...((webhookData.providerConfig as Record<string, any>) || {}),
  }

  try {
    // --- Essential IDs & Config from localProviderConfig ---
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      return
    }

    const credentialId: string | undefined = localProviderConfig.credentialId
    if (!credentialId) {
      logger.error(
        `[${requestId}] Missing credentialId in providerConfig for Airtable webhook ${webhookData.id}.`
      )
      return
    }

    let ownerUserId: string | null = null
    try {
      const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
      ownerUserId = rows.length ? rows[0].userId : null
    } catch (_e) {
      ownerUserId = null
    }

    if (!ownerUserId) {
      logger.error(
        `[${requestId}] Could not resolve owner for Airtable credential ${credentialId} on webhook ${webhookData.id}`
      )
      return
    }

    const storedCursor = localProviderConfig.externalWebhookCursor

    if (storedCursor === undefined || storedCursor === null) {
      logger.info(
        `[${requestId}] No cursor found in providerConfig for webhook ${webhookData.id}, initializing...`
      )
      localProviderConfig.externalWebhookCursor = null

      try {
        await db
          .update(webhook)
          .set({
            providerConfig: {
              ...localProviderConfig,
              externalWebhookCursor: null,
            },
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, webhookData.id))

        localProviderConfig.externalWebhookCursor = null
        logger.info(`[${requestId}] Successfully initialized cursor for webhook ${webhookData.id}`)
      } catch (initError: any) {
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: initError.message,
          stack: initError.stack,
        })
      }
    }

    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
      logger.debug(
        `[${requestId}] Using stored cursor: ${currentCursor} for webhook ${webhookData.id}`
      )
    } else {
      currentCursor = null
      logger.debug(
        `[${requestId}] No valid stored cursor for webhook ${webhookData.id}, starting from beginning`
      )
    }

    let accessToken: string | null = null
    try {
      accessToken = await refreshAccessTokenIfNeeded(credentialId, ownerUserId, requestId)
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to obtain valid Airtable access token via credential ${credentialId}.`
        )
        throw new Error('Airtable access token not found.')
      }

      logger.info(`[${requestId}] Successfully obtained Airtable access token`)
    } catch (tokenError: any) {
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for credential ${credentialId}`,
        {
          error: tokenError.message,
          stack: tokenError.stack,
          credentialId,
        }
      )
      return
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

    // --- Polling Loop ---
    while (mightHaveMore) {
      apiCallCount++
      // Safety break
      if (apiCallCount > 10) {
        logger.warn(`[${requestId}] Reached maximum polling limit (10 calls)`, {
          webhookId: webhookData.id,
          consolidatedCount: consolidatedChangesMap.size,
        })
        mightHaveMore = false
        break
      }

      const apiUrl = `${airtableApiBase}/bases/${baseId}/webhooks/${airtableWebhookId}/payloads`
      const queryParams = new URLSearchParams()
      if (currentCursor !== null) {
        queryParams.set('cursor', currentCursor.toString())
      }
      const fullUrl = `${apiUrl}?${queryParams.toString()}`

      logger.debug(`[${requestId}] Fetching Airtable payloads (call ${apiCallCount})`, {
        url: fullUrl,
        webhookId: webhookData.id,
      })

      try {
        const fetchStartTime = Date.now()
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        // DEBUG: Log API response time
        logger.debug(`[${requestId}] TRACE: Airtable API response received`, {
          status: response.status,
          duration: `${Date.now() - fetchStartTime}ms`,
          hasBody: true,
          apiCall: apiCallCount,
        })

        const responseBody = await response.json()

        if (!response.ok || responseBody.error) {
          const errorMessage =
            responseBody.error?.message ||
            responseBody.error ||
            `Airtable API error Status ${response.status}`
          logger.error(
            `[${requestId}] Airtable API request to /payloads failed (Call ${apiCallCount})`,
            {
              webhookId: webhookData.id,
              status: response.status,
              error: errorMessage,
            }
          )
          // Error logging handled by logging session
          mightHaveMore = false
          break
        }

        const receivedPayloads = responseBody.payloads || []
        logger.debug(
          `[${requestId}] Received ${receivedPayloads.length} payloads from Airtable (call ${apiCallCount})`
        )

        // --- Process and Consolidate Changes ---
        if (receivedPayloads.length > 0) {
          payloadsFetched += receivedPayloads.length
          // Keep the raw payloads for later exposure to the workflow
          for (const p of receivedPayloads) {
            allPayloads.push(p)
          }
          let changeCount = 0
          for (const payload of receivedPayloads) {
            if (payload.changedTablesById) {
              // DEBUG: Log tables being processed
              const tableIds = Object.keys(payload.changedTablesById)
              logger.debug(`[${requestId}] TRACE: Processing changes for tables`, {
                tables: tableIds,
                payloadTimestamp: payload.timestamp,
              })

              for (const [tableId, tableChangesUntyped] of Object.entries(
                payload.changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as any // Assert type

                // Handle created records
                if (tableChanges.createdRecordsById) {
                  const createdCount = Object.keys(tableChanges.createdRecordsById).length
                  changeCount += createdCount
                  // DEBUG: Log created records count
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${createdCount} created records for table ${tableId}`
                  )

                  for (const [recordId, recordDataUntyped] of Object.entries(
                    tableChanges.createdRecordsById
                  )) {
                    const recordData = recordDataUntyped as any // Assert type
                    const existingChange = consolidatedChangesMap.get(recordId)
                    if (existingChange) {
                      // Record was created and possibly updated within the same batch
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...(recordData.cellValuesByFieldId || {}),
                      }
                      // Keep changeType as 'created' if it started as created
                    } else {
                      // New creation
                      consolidatedChangesMap.set(recordId, {
                        tableId: tableId,
                        recordId: recordId,
                        changeType: 'created',
                        changedFields: recordData.cellValuesByFieldId || {},
                      })
                    }
                  }
                }

                // Handle updated records
                if (tableChanges.changedRecordsById) {
                  const updatedCount = Object.keys(tableChanges.changedRecordsById).length
                  changeCount += updatedCount
                  // DEBUG: Log updated records count
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${updatedCount} updated records for table ${tableId}`
                  )

                  for (const [recordId, recordDataUntyped] of Object.entries(
                    tableChanges.changedRecordsById
                  )) {
                    const recordData = recordDataUntyped as any // Assert type
                    const existingChange = consolidatedChangesMap.get(recordId)
                    const currentFields = recordData.current?.cellValuesByFieldId || {}

                    if (existingChange) {
                      // Existing record was updated again
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...currentFields,
                      }
                      // Ensure type is 'updated' if it was previously 'created'
                      existingChange.changeType = 'updated'
                      // Do not update previousFields again
                    } else {
                      // First update for this record in the batch
                      const newChange: AirtableChange = {
                        tableId: tableId,
                        recordId: recordId,
                        changeType: 'updated',
                        changedFields: currentFields,
                      }
                      if (recordData.previous?.cellValuesByFieldId) {
                        newChange.previousFields = recordData.previous.cellValuesByFieldId
                      }
                      consolidatedChangesMap.set(recordId, newChange)
                    }
                  }
                }
                // TODO: Handle deleted records (`destroyedRecordIds`) if needed
              }
            }
          }

          // DEBUG: Log totals for this batch
          logger.debug(
            `[${requestId}] TRACE: Processed ${changeCount} changes in API call ${apiCallCount})`,
            {
              currentMapSize: consolidatedChangesMap.size,
            }
          )
        }

        const nextCursor = responseBody.cursor
        mightHaveMore = responseBody.mightHaveMore || false

        if (nextCursor && typeof nextCursor === 'number' && nextCursor !== currentCursor) {
          logger.debug(`[${requestId}] Updating cursor from ${currentCursor} to ${nextCursor}`)
          currentCursor = nextCursor

          // Follow exactly the old implementation - use awaited update instead of parallel
          const updatedConfig = {
            ...localProviderConfig,
            externalWebhookCursor: currentCursor,
          }
          try {
            // Force a complete object update to ensure consistency in serverless env
            await db
              .update(webhook)
              .set({
                providerConfig: updatedConfig, // Use full object
                updatedAt: new Date(),
              })
              .where(eq(webhook.id, webhookData.id))

            localProviderConfig.externalWebhookCursor = currentCursor // Update local copy too
          } catch (dbError: any) {
            logger.error(`[${requestId}] Failed to persist Airtable cursor to DB`, {
              webhookId: webhookData.id,
              cursor: currentCursor,
              error: dbError.message,
            })
            // Error logging handled by logging session
            mightHaveMore = false
            throw new Error('Failed to save Airtable cursor, stopping processing.') // Re-throw to break loop clearly
          }
        } else if (!nextCursor || typeof nextCursor !== 'number') {
          logger.warn(`[${requestId}] Invalid or missing cursor received, stopping poll`, {
            webhookId: webhookData.id,
            apiCall: apiCallCount,
            receivedCursor: nextCursor,
          })
          mightHaveMore = false
        } else if (nextCursor === currentCursor) {
          logger.debug(`[${requestId}] Cursor hasn't changed (${currentCursor}), stopping poll`)
          mightHaveMore = false // Explicitly stop if cursor hasn't changed
        }
      } catch (fetchError: any) {
        logger.error(
          `[${requestId}] Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError
        )
        // Error logging handled by logging session
        mightHaveMore = false
        break
      }
    }
    // --- End Polling Loop ---

    // Convert map values to array for final processing
    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())
    logger.info(
      `[${requestId}] Consolidated ${finalConsolidatedChanges.length} Airtable changes across ${apiCallCount} API calls`
    )

    // --- Execute Workflow if we have changes (simplified - no lock check) ---
    if (finalConsolidatedChanges.length > 0 || allPayloads.length > 0) {
      try {
        // Build input exposing raw payloads and consolidated changes
        const latestPayload = allPayloads.length > 0 ? allPayloads[allPayloads.length - 1] : null
        const input: any = {
          // Raw Airtable payloads as received from the API
          payloads: allPayloads,
          latestPayload,
          // Consolidated, simplified changes for convenience
          airtableChanges: finalConsolidatedChanges,
          // Include webhook metadata for resolver fallbacks
          webhook: {
            data: {
              provider: 'airtable',
              providerConfig: webhookData.providerConfig,
              payload: latestPayload,
            },
          },
        }

        // CRITICAL EXECUTION TRACE POINT
        logger.info(
          `[${requestId}] CRITICAL_TRACE: Beginning workflow execution with ${finalConsolidatedChanges.length} Airtable changes`,
          {
            workflowId: workflowData.id,
            recordCount: finalConsolidatedChanges.length,
            timestamp: new Date().toISOString(),
            firstRecordId: finalConsolidatedChanges[0]?.recordId || 'none',
          }
        )

        // Return the processed input for the trigger.dev task to handle
        logger.info(`[${requestId}] CRITICAL_TRACE: Airtable changes processed, returning input`, {
          workflowId: workflowData.id,
          recordCount: finalConsolidatedChanges.length,
          rawPayloadCount: allPayloads.length,
          timestamp: new Date().toISOString(),
        })

        return input
      } catch (processingError: any) {
        logger.error(`[${requestId}] CRITICAL_TRACE: Error processing Airtable changes`, {
          workflowId: workflowData.id,
          error: processingError.message,
          stack: processingError.stack,
          timestamp: new Date().toISOString(),
        })

        throw processingError
      }
    } else {
      // DEBUG: Log when no changes are found
      logger.info(`[${requestId}] TRACE: No Airtable changes to process`, {
        workflowId: workflowData.id,
        apiCallCount,
        webhookId: webhookData.id,
      })
    }
  } catch (error) {
    // Catch any unexpected errors during the setup/polling logic itself
    logger.error(
      `[${requestId}] Unexpected error during asynchronous Airtable payload processing task`,
      {
        webhookId: webhookData.id,
        workflowId: workflowData.id,
        error: (error as Error).message,
      }
    )
    // Error logging handled by logging session
  }

  // DEBUG: Log function completion
  logger.debug(`[${requestId}] TRACE: fetchAndProcessAirtablePayloads completed`, {
    totalFetched: payloadsFetched,
    totalApiCalls: apiCallCount,
    totalChanges: consolidatedChangesMap.size,
    timestamp: new Date().toISOString(),
  })
}

// Define an interface for AirtableChange
export interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
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

  // Polling providers get unique paths per credential (for independent state)
  // External webhook providers share the same path (external service sends to one URL)
  const pollingProviders = ['gmail', 'outlook', 'rss', 'imap']
  const useUniquePaths = pollingProviders.includes(provider)

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
            eq(webhook.deploymentVersionId, deploymentVersionId)
          )
        : and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId))
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
        const webhookId = nanoid()
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

    // Verify credential exists and get userId
    const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    // Verify token can be refreshed
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, effectiveUserId, requestId)
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

    // Verify credential exists and get userId
    const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Outlook webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    // Verify token can be refreshed
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, effectiveUserId, requestId)
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
          rejectUnauthorized: providerConfig.rejectUnauthorized !== false,
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

/**
 * Validates a Cal.com webhook request signature using HMAC SHA-256
 * @param secret - Cal.com webhook secret (plain text)
 * @param signature - X-Cal-Signature-256 header value (hex-encoded HMAC SHA-256 signature)
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateCalcomSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Cal.com signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    // Cal.com sends signature in format: sha256=<hex>
    // We need to strip the prefix before comparing
    let providedSignature: string
    if (signature.startsWith('sha256=')) {
      providedSignature = signature.substring(7)
    } else {
      // If no prefix, use as-is (for backwards compatibility)
      providedSignature = signature
    }

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Cal.com signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Cal.com signature:', error)
    return false
  }
}
