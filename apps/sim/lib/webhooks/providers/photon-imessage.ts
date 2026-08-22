import { createLogger } from '@sim/logger'
import { slimEnvelopeSchema, verifySpectrumSignature } from '@spectrum-ts/core/webhook'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:PhotonImessage')

/** The only Photon event that carries a message today. */
const MESSAGES_EVENT = 'messages'

/**
 * Content arms that are conversation signals rather than received messages. A read receipt is
 * delivered on the same stream as a message, but firing a "Message Received" workflow on one
 * would double-run every conversation.
 */
const SIGNAL_CONTENT_TYPES = new Set(['read', 'typing'])

interface AttachmentSummary {
  id: string
  name: string
  mimeType: string
  size: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

function lowercaseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

/**
 * Collect the human-readable text from a content tree. A reply carries its own inner content and a
 * group carries N items, so the text a workflow wants is not always at the top level.
 */
function collectText(content: unknown): string {
  if (!isRecord(content)) {
    return ''
  }

  switch (content.type) {
    case 'text':
      return asString(content.text)
    case 'reply':
      return collectText(content.content)
    case 'group': {
      const items = Array.isArray(content.items) ? content.items : []
      return items
        .map((item) => (isRecord(item) ? collectText(item.content) : ''))
        .filter(Boolean)
        .join('\n')
    }
    default:
      return ''
  }
}

/**
 * Photon delivers attachment metadata only — bytes stay behind the platform and are fetched on
 * demand, which a webhook payload cannot do.
 */
function collectAttachments(content: unknown): AttachmentSummary[] {
  if (!isRecord(content)) {
    return []
  }

  switch (content.type) {
    case 'attachment':
    case 'voice':
      return [
        {
          id: asString(content.id),
          name: asString(content.name),
          mimeType: asString(content.mimeType),
          size: typeof content.size === 'number' ? content.size : null,
        },
      ]
    case 'reply':
      return collectAttachments(content.content)
    case 'group': {
      const items = Array.isArray(content.items) ? content.items : []
      return items.flatMap((item) => (isRecord(item) ? collectAttachments(item.content) : []))
    }
    default:
      return []
  }
}

export const photonImessageHandler: WebhookProviderHandler = {
  /**
   * Photon signs `v0:<timestamp>:<rawBody>` with HMAC-SHA256 and sends the digest as
   * `X-Spectrum-Signature: v0=<hex>` alongside `X-Spectrum-Timestamp`. Verification is delegated to
   * Photon's own portable verifier so the scheme — including its 5-minute replay window and
   * constant-time digest comparison — stays in step with the platform.
   *
   * Unlike `createHmacVerifier`, a missing secret fails closed: an inbound message can drive an
   * agent, so an unverified delivery must never reach one.
   */
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      logger.warn(`[${requestId}] Photon iMessage webhook secret not configured`)
      return new NextResponse('Unauthorized - Missing Photon webhook secret', { status: 401 })
    }

    const result = await verifySpectrumSignature({
      headers: lowercaseHeaders(request.headers),
      rawBody: new TextEncoder().encode(rawBody),
      secret,
    })

    if (!result.ok) {
      logger.warn(`[${requestId}] Photon iMessage signature verification failed`, {
        reason: result.reason,
      })
      return new NextResponse(`Unauthorized - Photon signature ${result.reason}`, { status: 401 })
    }

    return null
  },

  shouldSkipEvent({ body, requestId }: EventFilterContext): boolean {
    const parsed = slimEnvelopeSchema.safeParse(body)
    if (!parsed.success) {
      logger.info(`[${requestId}] Photon delivery did not match the message envelope, skipping`)
      return true
    }

    if (parsed.data.event !== MESSAGES_EVENT) {
      return true
    }

    return SIGNAL_CONTENT_TYPES.has(parsed.data.message.content.type)
  },

  async formatInput({ body, requestId }: FormatInputContext): Promise<FormatInputResult> {
    const parsed = slimEnvelopeSchema.safeParse(body)
    if (!parsed.success) {
      return { input: null, skip: { message: 'Payload is not a Photon message envelope' } }
    }

    const { message } = parsed.data
    const space = message.space
    const content = message.content

    logger.info(`[${requestId}] Formatting Photon iMessage delivery`, {
      contentType: content.type,
    })

    return {
      input: {
        messageId: message.id,
        text: collectText(content),
        contentType: content.type,
        senderId: message.sender?.id ?? '',
        chatId: space.id,
        chatType: asString((space as Record<string, unknown>).type),
        platform: message.platform ?? space.platform ?? '',
        timestamp: message.timestamp ?? '',
        attachments: collectAttachments(content),
        raw: JSON.stringify(body),
      },
    }
  },

  /** Photon delivers at least once, so retries of one delivery must collapse to one run. */
  extractIdempotencyId(body: unknown): string | null {
    if (!isRecord(body)) {
      return null
    }
    const message = body.message
    if (!isRecord(message)) {
      return null
    }
    const id = asString(message.id)
    return id ? `photon_imessage:${id}` : null
  },
}
