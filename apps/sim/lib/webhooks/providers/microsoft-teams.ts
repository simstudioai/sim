import crypto from 'crypto'
import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:MicrosoftTeams')

function validateMicrosoftTeamsSignature(
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

function parseFirstNotification(
  body: unknown
): { subscriptionId: string; messageId: string } | null {
  const obj = body as Record<string, unknown>
  const value = obj.value as unknown[] | undefined
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const notification = value[0] as Record<string, unknown>
  const subscriptionId = notification.subscriptionId as string | undefined
  const resourceData = notification.resourceData as Record<string, unknown> | undefined
  const messageId = resourceData?.id as string | undefined

  if (subscriptionId && messageId) {
    return { subscriptionId, messageId }
  }
  return null
}

async function fetchWithDNSPinning(
  url: string,
  accessToken: string,
  requestId: string
): Promise<SecureFetchResponse | null> {
  try {
    const urlValidation = await validateUrlWithDNS(url, 'contentUrl')
    if (!urlValidation.isValid) {
      logger.warn(`[${requestId}] Invalid content URL: ${urlValidation.error}`, { url })
      return null
    }
    const headers: Record<string, string> = {}
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }
    const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, { headers })
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
  body: Record<string, unknown>,
  foundWebhook: Record<string, unknown>,
  foundWorkflow: { id: string; userId: string },
  request: { headers: Map<string, string> }
): Promise<unknown> {
  const notification = (body.value as unknown[])?.[0] as Record<string, unknown> | undefined
  if (!notification) {
    logger.warn('Received empty Teams notification body')
    return null
  }
  const changeType = (notification.changeType as string) || 'created'
  const resource = (notification.resource as string) || ''
  const subscriptionId = (notification.subscriptionId as string) || ''

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
    const rdId = ((body?.value as unknown[])?.[0] as Record<string, unknown>)?.resourceData as
      | Record<string, unknown>
      | undefined
    const rdIdValue = rdId?.id as string | undefined
    if (collectionMatch && rdIdValue) {
      chatId = collectionMatch[1]
      messageId = rdIdValue
    }
  }

  if (
    (!chatId || !messageId) &&
    ((body?.value as unknown[])?.[0] as Record<string, unknown>)?.resourceData
  ) {
    const resourceData = ((body.value as unknown[])[0] as Record<string, unknown>)
      .resourceData as Record<string, unknown>
    const odataId = resourceData['@odata.id']
    if (typeof odataId === 'string') {
      const odataMatch = odataId.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
      if (odataMatch) {
        chatId = odataMatch[1]
        messageId = odataMatch[2]
      }
    }
  }

  if (!chatId || !messageId) {
    logger.warn('Could not resolve chatId/messageId from Teams notification', {
      resource,
      hasResourceDataId: Boolean(
        ((body?.value as unknown[])?.[0] as Record<string, unknown>)?.resourceData
      ),
      valueLength: Array.isArray(body?.value) ? (body.value as unknown[]).length : 0,
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
  const providerConfig = (foundWebhook?.providerConfig as Record<string, unknown>) || {}
  const credentialId = providerConfig.credentialId
  const includeAttachments = providerConfig.includeAttachments !== false

  let message: Record<string, unknown> | null = null
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
      const resolved = await resolveOAuthAccountId(credentialId as string)
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
          message = (await res.json()) as Record<string, unknown>

          if (includeAttachments && (message?.attachments as unknown[] | undefined)?.length) {
            const attachments = Array.isArray(message?.attachments)
              ? (message.attachments as Record<string, unknown>[])
              : []
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
                      const metadata = (await metadataRes.json()) as Record<string, unknown>
                      const downloadUrl = metadata['@microsoft.graph.downloadUrl'] as
                        | string
                        | undefined

                      if (downloadUrl) {
                        const downloadRes = await fetchWithDNSPinning(
                          downloadUrl,
                          '',
                          'teams-onedrive-download'
                        )

                        if (downloadRes?.ok) {
                          const arrayBuffer = await downloadRes.arrayBuffer()
                          buffer = Buffer.from(arrayBuffer)
                          const fileInfo = metadata.file as Record<string, unknown> | undefined
                          mimeType =
                            downloadRes.headers.get('content-type') ||
                            (fileInfo?.mimeType as string | undefined) ||
                            contentTypeHint ||
                            'application/octet-stream'

                          if (metadata.name && metadata.name !== attachmentName) {
                            attachmentName = metadata.name as string
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

                rawAttachments.push({
                  name: attachmentName,
                  data: buffer,
                  contentType: mimeType,
                  size,
                })
              } catch {
                /* skip attachment on error */
              }
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

  const messageText = (message.body as Record<string, unknown>)?.content || ''
  const from = ((message.from as Record<string, unknown>)?.user as Record<string, unknown>) || {}
  const createdAt = (message.createdDateTime as string) || ''

  return {
    message_id: resolvedMessageId,
    chat_id: resolvedChatId,
    from_name: (from.displayName as string) || '',
    text: messageText,
    created_at: createdAt,
    attachments: rawAttachments,
  }
}

export const microsoftTeamsHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new NextResponse('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      if (
        !validateMicrosoftTeamsSignature(providerConfig.hmacSecret as string, authHeader, rawBody)
      ) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HMAC signature', { status: 401 })
      }
    }

    return null
  },

  formatErrorResponse(error: string, status: number) {
    return NextResponse.json({ type: 'message', text: error }, { status })
  },

  enrichHeaders({ body }: EventFilterContext, headers: Record<string, string>) {
    const parsed = parseFirstNotification(body)
    if (parsed) {
      headers['x-teams-notification-id'] = `${parsed.subscriptionId}:${parsed.messageId}`
    }
  },

  extractIdempotencyId(body: unknown) {
    const parsed = parseFirstNotification(body)
    return parsed ? `${parsed.subscriptionId}:${parsed.messageId}` : null
  },

  formatSuccessResponse(providerConfig: Record<string, unknown>) {
    if (providerConfig.triggerId === 'microsoftteams_chat_subscription') {
      return new NextResponse(null, { status: 202 })
    }

    return NextResponse.json({ type: 'message', text: 'Sim' })
  },

  formatQueueErrorResponse() {
    return NextResponse.json(
      { type: 'message', text: 'Webhook processing failed' },
      { status: 500 }
    )
  },

  async formatInput({
    body,
    webhook,
    workflow,
    headers,
    requestId,
  }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const value = b?.value as unknown[] | undefined

    if (value && Array.isArray(value) && value.length > 0) {
      const mockRequest = {
        headers: new Map(Object.entries(headers)),
      } as unknown as import('next/server').NextRequest
      const result = await formatTeamsGraphNotification(
        b,
        webhook,
        workflow,
        mockRequest as unknown as { headers: Map<string, string> }
      )
      return { input: result }
    }

    const messageText = (b?.text as string) || ''
    const messageId = (b?.id as string) || ''
    const timestamp = (b?.timestamp as string) || (b?.localTimestamp as string) || ''
    const from = (b?.from || {}) as Record<string, unknown>
    const conversation = (b?.conversation || {}) as Record<string, unknown>

    return {
      input: {
        from: {
          id: (from.id || '') as string,
          name: (from.name || '') as string,
          aadObjectId: (from.aadObjectId || '') as string,
        },
        message: {
          raw: {
            attachments: b?.attachments || [],
            channelData: b?.channelData || {},
            conversation: b?.conversation || {},
            text: messageText,
            messageType: (b?.type || 'message') as string,
            channelId: (b?.channelId || '') as string,
            timestamp,
          },
        },
        activity: b || {},
        conversation: {
          id: (conversation.id || '') as string,
          name: (conversation.name || '') as string,
          isGroup: (conversation.isGroup || false) as boolean,
          tenantId: (conversation.tenantId || '') as string,
          aadObjectId: (conversation.aadObjectId || '') as string,
          conversationType: (conversation.conversationType || '') as string,
        },
      },
    }
  },
}
