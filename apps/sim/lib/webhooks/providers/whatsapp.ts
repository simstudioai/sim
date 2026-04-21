import { createHash, createHmac } from 'crypto'
import { db, workflowDeploymentVersion } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:WhatsApp')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getWhatsAppChanges(
  body: unknown
): Array<{ field?: string; value: Record<string, unknown> }> {
  if (!isRecord(body) || !Array.isArray(body.entry)) {
    return []
  }

  const changes: Array<{ field?: string; value: Record<string, unknown> }> = []

  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        continue
      }

      changes.push({
        field: typeof change.field === 'string' ? change.field : undefined,
        value: change.value,
      })
    }
  }

  return changes
}

function normalizeWhatsAppContact(contact: Record<string, unknown>) {
  const profile = isRecord(contact.profile) ? contact.profile : undefined

  return {
    wa_id: typeof contact.wa_id === 'string' ? contact.wa_id : undefined,
    profile: profile
      ? {
          name: typeof profile.name === 'string' ? profile.name : undefined,
        }
      : undefined,
  }
}

function normalizeWhatsAppMessage(
  message: Record<string, unknown>,
  metadata?: Record<string, unknown>
) {
  const text = isRecord(message.text) ? message.text : undefined

  return {
    messageId: typeof message.id === 'string' ? message.id : undefined,
    from: typeof message.from === 'string' ? message.from : undefined,
    phoneNumberId:
      typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : undefined,
    displayPhoneNumber:
      typeof metadata?.display_phone_number === 'string'
        ? metadata.display_phone_number
        : undefined,
    text: typeof text?.body === 'string' ? text.body : undefined,
    timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
    messageType: typeof message.type === 'string' ? message.type : undefined,
    raw: message,
  }
}

function normalizeWhatsAppStatus(
  status: Record<string, unknown>,
  metadata?: Record<string, unknown>
) {
  return {
    messageId: typeof status.id === 'string' ? status.id : undefined,
    recipientId: typeof status.recipient_id === 'string' ? status.recipient_id : undefined,
    phoneNumberId:
      typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : undefined,
    displayPhoneNumber:
      typeof metadata?.display_phone_number === 'string'
        ? metadata.display_phone_number
        : undefined,
    status: typeof status.status === 'string' ? status.status : undefined,
    timestamp: typeof status.timestamp === 'string' ? status.timestamp : undefined,
    conversation: isRecord(status.conversation) ? status.conversation : undefined,
    pricing: isRecord(status.pricing) ? status.pricing : undefined,
    raw: status,
  }
}

function validateWhatsAppSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!signature.startsWith('sha256=')) {
      logger.warn('WhatsApp signature has invalid format')
      return false
    }

    const providedSignature = signature.substring(7)
    const computedSignature = createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    return safeCompare(computedSignature, providedSignature)
  } catch (error) {
    logger.error('Error validating WhatsApp signature:', error)
    return false
  }
}

function buildWhatsAppIdempotencyKey(keys: Set<string>): string | null {
  if (keys.size === 0) {
    return null
  }

  const sortedKeys = Array.from(keys).sort()
  const digest = createHash('sha256').update(sortedKeys.join('|'), 'utf8').digest('hex')
  return `whatsapp:${sortedKeys.length}:${digest}`
}

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
          eq(webhook.path, path),
          eq(webhook.isActive, true),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )

    for (const row of webhooks) {
      const wh = row.webhook
      const providerConfig = (wh.providerConfig as Record<string, unknown>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
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

export const whatsappHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }) {
    const appSecret = providerConfig.appSecret as string | undefined
    if (!appSecret) {
      logger.warn(
        `[${requestId}] WhatsApp webhook missing appSecret in providerConfig — rejecting request`
      )
      return new NextResponse('Unauthorized - WhatsApp app secret not configured', { status: 401 })
    }

    const signature = request.headers.get('x-hub-signature-256')
    if (!signature) {
      logger.warn(`[${requestId}] WhatsApp webhook missing signature header`)
      return new NextResponse('Unauthorized - Missing WhatsApp signature', { status: 401 })
    }

    if (!validateWhatsAppSignature(appSecret, signature, rawBody)) {
      logger.warn(`[${requestId}] WhatsApp signature verification failed`)
      return new NextResponse('Unauthorized - Invalid WhatsApp signature', { status: 401 })
    }

    return null
  },

  async handleChallenge(_body: unknown, request: NextRequest, requestId: string, path: string) {
    const url = new URL(request.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    return handleWhatsAppVerification(requestId, path, mode, token, challenge)
  },

  extractIdempotencyId(body: unknown) {
    const keys = new Set<string>()

    for (const { field, value } of getWhatsAppChanges(body)) {
      if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
          if (!isRecord(message) || typeof message.id !== 'string') {
            continue
          }

          keys.add(`${field ?? 'messages'}:message:${message.id}`)
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          if (!isRecord(status) || typeof status.id !== 'string') {
            continue
          }

          const statusValue = typeof status.status === 'string' ? status.status : ''
          const timestamp = typeof status.timestamp === 'string' ? status.timestamp : ''
          keys.add(`${field ?? 'messages'}:status:${status.id}:${statusValue}:${timestamp}`)
        }
      }

      if (Array.isArray(value.groups)) {
        for (const group of value.groups) {
          if (!isRecord(group) || typeof group.request_id !== 'string') {
            continue
          }

          keys.add(`${field ?? 'groups'}:group:${group.request_id}`)
        }
      }
    }

    return buildWhatsAppIdempotencyKey(keys)
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = isRecord(body) ? body : undefined
    const contacts: Array<{ wa_id?: string; profile?: { name?: string } }> = []
    const messages: Array<{
      messageId?: string
      from?: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      text?: string
      timestamp?: string
      messageType?: string
      raw: Record<string, unknown>
    }> = []
    const statuses: Array<{
      messageId?: string
      recipientId?: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      status?: string
      timestamp?: string
      conversation?: Record<string, unknown>
      pricing?: Record<string, unknown>
      raw: Record<string, unknown>
    }> = []

    for (const { value } of getWhatsAppChanges(body)) {
      const metadata = isRecord(value.metadata) ? value.metadata : undefined

      if (Array.isArray(value.contacts)) {
        for (const contact of value.contacts) {
          if (!isRecord(contact)) {
            continue
          }

          contacts.push(normalizeWhatsAppContact(contact))
        }
      }

      if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
          if (!isRecord(message)) {
            continue
          }

          messages.push(normalizeWhatsAppMessage(message, metadata))
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          if (!isRecord(status)) {
            continue
          }

          statuses.push(normalizeWhatsAppStatus(status, metadata))
        }
      }
    }

    if (messages.length === 0 && statuses.length === 0) {
      return { input: null }
    }

    const firstMessage = messages[0]
    const firstStatus = statuses[0]

    return {
      input: {
        eventType:
          messages.length > 0 && statuses.length > 0
            ? 'mixed'
            : messages.length > 0
              ? 'incoming_message'
              : 'message_status',
        messageId: firstMessage?.messageId ?? firstStatus?.messageId,
        from: firstMessage?.from,
        recipientId: firstStatus?.recipientId,
        phoneNumberId: firstMessage?.phoneNumberId ?? firstStatus?.phoneNumberId,
        displayPhoneNumber: firstMessage?.displayPhoneNumber ?? firstStatus?.displayPhoneNumber,
        text: firstMessage?.text,
        timestamp: firstMessage?.timestamp ?? firstStatus?.timestamp,
        messageType: firstMessage?.messageType,
        status: firstStatus?.status,
        contact: contacts[0],
        webhookContacts: contacts,
        messages,
        statuses,
        conversation: firstStatus?.conversation,
        pricing: firstStatus?.pricing,
        raw: payload ?? body,
      },
    }
  },

  handleEmptyInput(requestId: string) {
    logger.info(
      `[${requestId}] No messages or status updates in WhatsApp payload, skipping execution`
    )
    return { message: 'No messages or status updates in WhatsApp payload' }
  },
}
