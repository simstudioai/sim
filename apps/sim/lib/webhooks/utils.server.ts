import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

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
    // This is a WhatsApp verification request
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

    // Check if any webhook has a matching verification token
    for (const wh of webhooks) {
      const providerConfig = (wh.providerConfig as Record<string, any>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        // Return ONLY the challenge as plain text (exactly as WhatsApp expects)
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
 * Format Microsoft Teams Graph change notification
 */
async function formatTeamsGraphNotification(
  body: any,
  foundWebhook: any,
  foundWorkflow: any,
  request: NextRequest
): Promise<any> {
  const notification = body.value[0]
  const changeType = notification.changeType || 'created'
  const resource = notification.resource || ''
  const subscriptionId = notification.subscriptionId || ''

  // Extract chatId and messageId from resource path
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
      input: 'Teams notification received',
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook?.path || '',
          providerConfig: foundWebhook?.providerConfig || {},
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
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

  // Teams chat subscriptions require credentials
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
      // Get userId from credential
      const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
      if (rows.length === 0) {
        logger.error('Teams credential not found', { credentialId, chatId: resolvedChatId })
        // Continue without message data
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
                    const directRes = await fetch(contentUrl, {
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
                        const downloadRes = await fetch(downloadUrl)

                        if (downloadRes.ok) {
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
                    const ares = await fetch(contentUrl, {
                      headers: { Authorization: `Bearer ${accessToken}` },
                    })
                    if (ares.ok) {
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

  // If no message was fetched, return minimal data
  if (!message) {
    logger.warn('No message data available for Teams notification', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      hasCredential: !!credentialId,
    })
    return {
      input: '',
      message_id: messageId,
      chat_id: chatId,
      from_name: 'Unknown',
      text: '',
      created_at: notification.resourceData?.createdDateTime || '',
      change_type: changeType,
      subscription_id: subscriptionId,
      attachments: [],
      microsoftteams: {
        message: { id: messageId, text: '', timestamp: '', chatId, raw: null },
        from: { id: '', name: 'Unknown', aadObjectId: '' },
        notification: { changeType, subscriptionId, resource },
      },
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook?.path || '',
          providerConfig: foundWebhook?.providerConfig || {},
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Extract data from message - we know it exists now
  // body.content is the HTML/text content, summary is a plain text preview (max 280 chars)
  const messageText = message.body?.content || ''
  const from = message.from?.user || {}
  const createdAt = message.createdDateTime || ''

  return {
    input: messageText,
    message_id: messageId,
    chat_id: chatId,
    from_name: from.displayName || 'Unknown',
    text: messageText,
    created_at: createdAt,
    change_type: changeType,
    subscription_id: subscriptionId,
    attachments: rawAttachments,
    microsoftteams: {
      message: {
        id: messageId,
        text: messageText,
        timestamp: createdAt,
        chatId,
        raw: message,
      },
      from: {
        id: from.id,
        name: from.displayName,
        aadObjectId: from.aadObjectId,
      },
      notification: {
        changeType,
        subscriptionId,
        resource,
      },
    },
    webhook: {
      data: {
        provider: 'microsoftteams',
        path: foundWebhook?.path || '',
        providerConfig: foundWebhook?.providerConfig || {},
        payload: body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
      },
    },
    workflowId: foundWorkflow.id,
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

    if (signatureBase64.length !== signature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < signatureBase64.length; i++) {
      result |= signatureBase64.charCodeAt(i) ^ signature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    logger.error('Error validating Twilio signature:', error)
    return false
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
      const phoneNumberId = data.metadata?.phone_number_id
      const from = message.from
      const messageId = message.id
      const timestamp = message.timestamp
      const text = message.text?.body

      return {
        whatsapp: {
          data: {
            messageId,
            from,
            phoneNumberId,
            text,
            timestamp,
            raw: message,
          },
        },
        webhook: {
          data: {
            provider: 'whatsapp',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    const message =
      body?.message || body?.edited_message || body?.channel_post || body?.edited_channel_post

    if (message) {
      let input = ''

      if (message.text) {
        input = message.text
      } else if (message.caption) {
        input = message.caption
      } else if (message.photo) {
        input = 'Photo message'
      } else if (message.document) {
        input = `Document: ${message.document.file_name || 'file'}`
      } else if (message.audio) {
        input = `Audio: ${message.audio.title || 'audio file'}`
      } else if (message.video) {
        input = 'Video message'
      } else if (message.voice) {
        input = 'Voice message'
      } else if (message.sticker) {
        input = `Sticker: ${message.sticker.emoji || '🎭'}`
      } else if (message.location) {
        input = 'Location shared'
      } else if (message.contact) {
        input = `Contact: ${message.contact.first_name || 'contact'}`
      } else if (message.poll) {
        input = `Poll: ${message.poll.question}`
      } else {
        input = 'Message received'
      }

      const messageObj = {
        id: message.message_id,
        text: message.text,
        caption: message.caption,
        date: message.date,
        messageType: message.photo
          ? 'photo'
          : message.document
            ? 'document'
            : message.audio
              ? 'audio'
              : message.video
                ? 'video'
                : message.voice
                  ? 'voice'
                  : message.sticker
                    ? 'sticker'
                    : message.location
                      ? 'location'
                      : message.contact
                        ? 'contact'
                        : message.poll
                          ? 'poll'
                          : 'text',
        raw: message,
      }

      const senderObj = message.from
        ? {
            id: message.from.id,
            firstName: message.from.first_name,
            lastName: message.from.last_name,
            username: message.from.username,
            languageCode: message.from.language_code,
            isBot: message.from.is_bot,
          }
        : null

      const chatObj = message.chat
        ? {
            id: message.chat.id,
            type: message.chat.type,
            title: message.chat.title,
            username: message.chat.username,
            firstName: message.chat.first_name,
            lastName: message.chat.last_name,
          }
        : null

      return {
        input,

        // Top-level properties for backward compatibility with <blockName.message> syntax
        message: messageObj,
        sender: senderObj,
        chat: chatObj,
        updateId: body.update_id,
        updateType: body.message
          ? 'message'
          : body.edited_message
            ? 'edited_message'
            : body.channel_post
              ? 'channel_post'
              : body.edited_channel_post
                ? 'edited_channel_post'
                : 'unknown',

        // Keep the nested structure for the new telegram.message.text syntax
        telegram: {
          message: messageObj,
          sender: senderObj,
          chat: chatObj,
          updateId: body.update_id,
          updateType: body.message
            ? 'message'
            : body.edited_message
              ? 'edited_message'
              : body.channel_post
                ? 'channel_post'
                : body.edited_channel_post
                  ? 'edited_channel_post'
                  : 'unknown',
        },
        webhook: {
          data: {
            provider: 'telegram',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Telegram update types
    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Telegram update received',
      telegram: {
        updateId: body.update_id,
        updateType: 'unknown',
        raw: body,
      },
      webhook: {
        data: {
          provider: 'telegram',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'twilio_voice') {
    return {
      // Root-level properties matching trigger outputs for easy access
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

      // Additional fields from Twilio payload
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

      webhook: {
        data: {
          provider: 'twilio_voice',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body
    }
    return body
  }

  if (foundWebhook.provider === 'outlook') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body
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
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'microsoftteams') {
    // Check if this is a Microsoft Graph change notification
    if (body?.value && Array.isArray(body.value) && body.value.length > 0) {
      return await formatTeamsGraphNotification(body, foundWebhook, foundWorkflow, request)
    }

    // Microsoft Teams outgoing webhook - Teams sending data to us
    const messageText = body?.text || ''
    const messageId = body?.id || ''
    const timestamp = body?.timestamp || body?.localTimestamp || ''
    const from = body?.from || {}
    const conversation = body?.conversation || {}

    // Construct the message object
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

    // Construct the from object
    const fromObj = {
      id: from.id || '',
      name: from.name || '',
      aadObjectId: from.aadObjectId || '',
    }

    // Construct the conversation object
    const conversationObj = {
      id: conversation.id || '',
      name: conversation.name || '',
      isGroup: conversation.isGroup || false,
      tenantId: conversation.tenantId || '',
      aadObjectId: conversation.aadObjectId || '',
      conversationType: conversation.conversationType || '',
    }

    // Construct the activity object
    const activityObj = body || {}

    return {
      input: messageText, // Primary workflow input - the message text

      // Top-level properties for direct access with <microsoftteams.from.name> syntax
      from: fromObj,
      message: messageObj,
      activity: activityObj,
      conversation: conversationObj,

      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'slack') {
    // Slack input formatting logic - check for valid event
    const event = body?.event

    if (event && body?.type === 'event_callback') {
      // Extract event text with fallbacks for different event types
      let input = ''

      if (event.text) {
        input = event.text
      } else if (event.type === 'app_mention') {
        input = 'App mention received'
      } else {
        input = 'Slack event received'
      }

      // Create the event object for easier access
      const eventObj = {
        event_type: event.type || '',
        channel: event.channel || '',
        channel_name: '', // Could be resolved via additional API calls if needed
        user: event.user || '',
        user_name: '', // Could be resolved via additional API calls if needed
        text: event.text || '',
        timestamp: event.ts || event.event_ts || '',
        team_id: body.team_id || event.team || '',
        event_id: body.event_id || '',
      }

      return {
        input, // Primary workflow input - the event content

        // // // Top-level properties for backward compatibility with <blockName.event> syntax
        event: eventObj,

        // Keep the nested structure for the new slack.event.text syntax
        slack: {
          event: eventObj,
        },
        webhook: {
          data: {
            provider: 'slack',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Slack event types
    logger.warn('Unknown Slack event type', {
      type: body?.type,
      hasEvent: !!body?.event,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Slack webhook received',
      slack: {
        event: {
          event_type: body?.event?.type || body?.type || 'unknown',
          channel: body?.event?.channel || '',
          user: body?.event?.user || '',
          text: body?.event?.text || '',
          timestamp: body?.event?.ts || '',
          team_id: body?.team_id || '',
          event_id: body?.event_id || '',
        },
      },
      webhook: {
        data: {
          provider: 'slack',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'webflow') {
    const triggerType = body?.triggerType || 'unknown'
    const siteId = body?.siteId || ''
    const workspaceId = body?.workspaceId || ''
    const collectionId = body?.collectionId || ''
    const payload = body?.payload || {}
    const formId = body?.formId || ''
    const formName = body?.name || ''
    const formSubmissionId = body?.id || ''
    const submittedAt = body?.submittedAt || ''
    const formData = body?.data || {}
    const schema = body?.schema || {}

    return {
      siteId,
      workspaceId,
      collectionId,
      payload,
      triggerType,

      formId,
      name: formName,
      id: formSubmissionId,
      submittedAt,
      data: formData,
      schema,
      formElementId: body?.formElementId || '',

      webflow: {
        siteId,
        workspaceId,
        collectionId,
        payload,
        triggerType,
        raw: body,
      },

      webhook: {
        data: {
          provider: 'webflow',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'generic') {
    return body
  }

  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    // Normalize answers: if value is an array with single element, collapse to scalar; keep multi-select arrays
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

    const normalizedAnswers = normalizeAnswers(body?.answers)

    const summaryCount = Object.keys(normalizedAnswers).length
    const input = `Google Form response${responseId ? ` ${responseId}` : ''} (${summaryCount} answers)`

    return {
      input,
      responseId,
      createTime,
      lastSubmittedTime,
      formId,
      answers: normalizedAnswers,
      ...(includeRaw ? { raw: body?.raw ?? body } : {}),
      google_forms: {
        responseId,
        createTime,
        lastSubmittedTime,
        formId,
        answers: normalizedAnswers,
        ...(includeRaw ? { raw: body?.raw ?? body } : {}),
      },
      webhook: {
        data: {
          provider: 'google_forms',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: includeRaw ? body : undefined,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'github') {
    // GitHub webhook input formatting logic
    const eventType = request.headers.get('x-github-event') || 'unknown'
    const delivery = request.headers.get('x-github-delivery') || ''

    // Extract common GitHub properties
    const repository = body?.repository || {}
    const sender = body?.sender || {}
    const action = body?.action || ''

    // Build GitHub-specific variables based on the trigger config outputs
    const githubData = {
      // Event metadata
      event_type: eventType,
      action: action,
      delivery_id: delivery,

      // Repository information (avoid 'repository' to prevent conflict with the object)
      repository_full_name: repository.full_name || '',
      repository_name: repository.name || '',
      repository_owner: repository.owner?.login || '',
      repository_id: repository.id || '',
      repository_url: repository.html_url || '',

      // Sender information (avoid 'sender' to prevent conflict with the object)
      sender_login: sender.login || '',
      sender_id: sender.id || '',
      sender_type: sender.type || '',
      sender_url: sender.html_url || '',

      // Event-specific data
      ...(body?.ref && {
        ref: body.ref,
        branch: body.ref?.replace('refs/heads/', '') || '',
      }),
      ...(body?.before && { before: body.before }),
      ...(body?.after && { after: body.after }),
      ...(body?.commits && {
        commits: JSON.stringify(body.commits),
        commit_count: body.commits.length || 0,
      }),
      ...(body?.head_commit && {
        commit_message: body.head_commit.message || '',
        commit_author: body.head_commit.author?.name || '',
        commit_sha: body.head_commit.id || '',
        commit_url: body.head_commit.url || '',
      }),
      ...(body?.pull_request && {
        pull_request: JSON.stringify(body.pull_request),
        pr_number: body.pull_request.number || '',
        pr_title: body.pull_request.title || '',
        pr_state: body.pull_request.state || '',
        pr_url: body.pull_request.html_url || '',
      }),
      ...(body?.issue && {
        issue: JSON.stringify(body.issue),
        issue_number: body.issue.number || '',
        issue_title: body.issue.title || '',
        issue_state: body.issue.state || '',
        issue_url: body.issue.html_url || '',
      }),
      ...(body?.comment && {
        comment: JSON.stringify(body.comment),
        comment_body: body.comment.body || '',
        comment_url: body.comment.html_url || '',
      }),
    }

    // Set input based on event type for workflow processing
    let input = ''
    switch (eventType) {
      case 'push':
        input = `Push to ${githubData.branch || githubData.ref}: ${githubData.commit_message || 'No commit message'}`
        break
      case 'pull_request':
        input = `${action} pull request: ${githubData.pr_title || 'No title'}`
        break
      case 'issues':
        input = `${action} issue: ${githubData.issue_title || 'No title'}`
        break
      case 'issue_comment':
      case 'pull_request_review_comment':
        input = `Comment ${action}: ${githubData.comment_body?.slice(0, 100) || 'No comment body'}${(githubData.comment_body?.length || 0) > 100 ? '...' : ''}`
        break
      default:
        input = `GitHub ${eventType} event${action ? ` (${action})` : ''}`
    }

    return {
      // Expose raw GitHub payload at the root
      ...body,
      // Include webhook metadata alongside
      webhook: {
        data: {
          provider: 'github',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'typeform') {
    const eventId = body?.event_id || ''
    const eventType = body?.event_type || 'form_response'
    const formResponse = body?.form_response || {}
    const formId = formResponse.form_id || ''
    const token = formResponse.token || ''
    const submittedAt = formResponse.submitted_at || ''
    const landedAt = formResponse.landed_at || ''
    const calculated = formResponse.calculated || {}
    const variables = formResponse.variables || []
    const hidden = formResponse.hidden || {}
    const answers = formResponse.answers || []
    const definition = formResponse.definition || {}
    const ending = formResponse.ending || {}

    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const includeDefinition = providerConfig.includeDefinition === true

    return {
      event_id: eventId,
      event_type: eventType,
      form_id: formId,
      token,
      submitted_at: submittedAt,
      landed_at: landedAt,
      calculated,
      variables,
      hidden,
      answers,
      ...(includeDefinition ? { definition } : {}),
      ending,

      typeform: {
        event_id: eventId,
        event_type: eventType,
        form_id: formId,
        token,
        submitted_at: submittedAt,
        landed_at: landedAt,
        calculated,
        variables,
        hidden,
        answers,
        ...(includeDefinition ? { definition } : {}),
        ending,
      },

      raw: body,

      webhook: {
        data: {
          provider: 'typeform',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'linear') {
    // Linear webhook payload structure:
    // { action, type, webhookId, webhookTimestamp, organizationId, createdAt, actor, data, updatedFrom? }
    return {
      // Extract top-level fields from Linear payload
      action: body.action || '',
      type: body.type || '',
      webhookId: body.webhookId || '',
      webhookTimestamp: body.webhookTimestamp || 0,
      organizationId: body.organizationId || '',
      createdAt: body.createdAt || '',
      actor: body.actor || null,
      data: body.data || null,
      updatedFrom: body.updatedFrom || null,

      // Keep webhook metadata
      webhook: {
        data: {
          provider: 'linear',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Jira webhook format
  if (foundWebhook.provider === 'jira') {
    const { extractIssueData, extractCommentData, extractWorklogData } = await import(
      '@/triggers/jira/utils'
    )

    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    let extractedData
    if (triggerId === 'jira_issue_commented') {
      extractedData = extractCommentData(body)
    } else if (triggerId === 'jira_worklog_created') {
      extractedData = extractWorklogData(body)
    } else {
      extractedData = extractIssueData(body)
    }

    return {
      ...extractedData,
      webhook: {
        data: {
          provider: 'jira',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'stripe') {
    return {
      ...body,
      webhook: {
        data: {
          provider: 'stripe',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Generic format for other providers
  return {
    webhook: {
      data: {
        path: foundWebhook.path,
        provider: foundWebhook.provider,
        providerConfig: foundWebhook.providerConfig,
        payload: body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
      },
    },
    workflowId: foundWorkflow.id,
  }
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

    const crypto = require('crypto')
    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')

    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
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

    const crypto = require('crypto')
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
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

    const crypto = require('crypto')
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Linear signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })

    if (computedHash.length !== signature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ signature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
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

    const crypto = require('crypto')
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Jira signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    logger.error('Error validating Jira signature:', error)
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

    const crypto = require('crypto')
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

    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
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
      if (providerConfig.secret) {
        const secretHeader = request.headers.get('X-Webhook-Secret')
        if (!secretHeader || secretHeader.length !== providerConfig.secret.length) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
        let result = 0
        for (let i = 0; i < secretHeader.length; i++) {
          result |= secretHeader.charCodeAt(i) ^ providerConfig.secret.charCodeAt(i)
        }
        if (result !== 0) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
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
    case 'microsoftteams':
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
 * Configure Gmail polling for a webhook
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

    // Get userId from credential
    const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId
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
          ...(credentialId ? { credentialId } : {}),
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: now.toISOString(),
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
 * Configure Outlook polling for a webhook
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

    // Get userId from credential
    const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Outlook webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, effectiveUserId, requestId)
    if (!accessToken) {
      logger.error(
        `[${requestId}] Failed to refresh/access Outlook token for credential ${credentialId}`
      )
      return false
    }

    const providerCfg = (webhookData.providerConfig as Record<string, any>) || {}

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerCfg,
          userId: effectiveUserId,
          ...(credentialId ? { credentialId } : {}),
          maxEmailsPerPoll:
            typeof providerCfg.maxEmailsPerPoll === 'string'
              ? Number.parseInt(providerCfg.maxEmailsPerPoll, 10) || 25
              : providerCfg.maxEmailsPerPoll || 25,
          pollingInterval:
            typeof providerCfg.pollingInterval === 'string'
              ? Number.parseInt(providerCfg.pollingInterval, 10) || 5
              : providerCfg.pollingInterval || 5,
          markAsRead: providerCfg.markAsRead || false,
          includeRawEmail: providerCfg.includeRawEmail || false,
          folderIds: providerCfg.folderIds || ['inbox'],
          folderFilterBehavior: providerCfg.folderFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: now.toISOString(),
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

export function convertSquareBracketsToTwiML(twiml: string | undefined): string | undefined {
  if (!twiml) {
    return twiml
  }

  // Replace [Tag] with <Tag> and [/Tag] with </Tag>
  return twiml.replace(/\[(\/?[^\]]+)\]/g, '<$1>')
}
