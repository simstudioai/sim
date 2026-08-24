import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { slimEnvelopeSchema, verifySpectrumSignature } from '@spectrum-ts/core/webhook'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventFilterContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  PHOTON_NON_MESSAGE_CONTENT_TYPES,
  PHOTON_SKIPPED_CONTENT_TYPES,
} from '@/triggers/photon_imessage/utils'

const logger = createLogger('WebhookProvider:PhotonImessage')

/** The only Photon event that carries a message today. */
const MESSAGES_EVENT = 'messages'

/** Photon's webhook management API. Auth is HTTP Basic with projectId:projectSecret. */
const PHOTON_WEBHOOKS_API_BASE = 'https://spectrum.photon.codes/projects'

const NON_MESSAGE_TYPES = new Set<string>(PHOTON_NON_MESSAGE_CONTENT_TYPES)
const SKIPPED_TYPES = new Set<string>(PHOTON_SKIPPED_CONTENT_TYPES)

/**
 * Photon delivers our own sends back on the same webhook, tagged `outbound`. A workflow that
 * replies would then be re-triggered by its own reply and loop, so no trigger ever sees one.
 *
 * The test is for an explicit `outbound` rather than for `inbound`: the envelope field is
 * optional, and a delivery that omits it must keep firing the trigger it fires today.
 */
const OUTBOUND_DIRECTION = 'outbound'

interface AttachmentSummary {
  id: string
  name: string
  mimeType: string
  size: number | null
}

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
  if (!isRecordLike(content)) {
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
        .map((item) => (isRecordLike(item) ? collectText(item.content) : ''))
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
  if (!isRecordLike(content)) {
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
      return items.flatMap((item) => (isRecordLike(item) ? collectAttachments(item.content) : []))
    }
    default:
      return []
  }
}

/** Parse the optional comma/newline-separated sender allowlist into normalized handles. */
export function parseSenderAllowlist(value: unknown): string[] {
  if (typeof value !== 'string') {
    return []
  }
  return value
    .split(/[\n,]/)
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean)
}

function parseEnvelope(body: unknown) {
  const parsed = slimEnvelopeSchema.safeParse(body)
  if (!parsed.success || parsed.data.event !== MESSAGES_EVENT) {
    return null
  }
  return parsed.data
}

function basicAuthHeader(projectId: string, projectSecret: string): string {
  return `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString('base64')}`
}

interface PhotonWebhookRecord {
  id?: string
  webhookUrl?: string
  signingSecret?: string
}

async function photonWebhooksRequest(
  projectId: string,
  projectSecret: string,
  path: string,
  init?: { method?: string }
): Promise<{ status: number; body: { succeed?: boolean; data?: unknown } }> {
  const response = await fetch(`${PHOTON_WEBHOOKS_API_BASE}/${projectId}/webhooks/${path}`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: basicAuthHeader(projectId, projectSecret) },
  })
  const body = (await response.json().catch(() => ({}))) as {
    succeed?: boolean
    data?: unknown
  }
  return { status: response.status, body }
}

export const photonImessageHandler: WebhookProviderHandler = {
  /**
   * Photon signs `v0:<timestamp>:<rawBody>` with HMAC-SHA256 and sends the digest as
   * `X-Spectrum-Signature: v0=<hex>` alongside `X-Spectrum-Timestamp`. Verification is delegated to
   * Photon's own portable verifier so the scheme — including its 5-minute replay window and
   * constant-time digest comparison — stays in step with the platform.
   *
   * The signing secret is written by `createSubscription` when the trigger deploys. A missing
   * secret fails closed: an inbound message can drive an agent, so an unverified delivery must
   * never reach one.
   */
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const secret = providerConfig.signingSecret as string | undefined
    if (!secret) {
      logger.warn(`[${requestId}] Photon iMessage signing secret not configured`)
      return new NextResponse('Unauthorized - Missing Photon signing secret', { status: 401 })
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

  /**
   * Drop payloads that are not message envelopes, our own outbound sends, and signals that never
   * fire any trigger.
   */
  shouldSkipEvent({ body, requestId }: EventFilterContext): boolean {
    const envelope = parseEnvelope(body)
    if (!envelope) {
      logger.info(`[${requestId}] Photon delivery did not match the message envelope, skipping`)
      return true
    }
    if (envelope.message.direction === OUTBOUND_DIRECTION) {
      logger.info(`[${requestId}] Photon delivery is our own outbound send, skipping`)
      return true
    }
    return SKIPPED_TYPES.has(envelope.message.content.type)
  },

  /**
   * Route each delivery to the trigger that claimed it. All four triggers share one Photon
   * webhook; the content `type` is the event discriminator:
   * - `photon_imessage_webhook` takes everything
   * - `photon_imessage_reaction_received` takes `reaction`
   * - `photon_imessage_read_receipt` takes `read`
   * - `photon_imessage_message_received` takes everything that is not one of those
   */
  matchEvent({ body, providerConfig, requestId }: EventMatchContext): boolean {
    const envelope = parseEnvelope(body)
    if (!envelope) {
      return false
    }

    const allowlist = parseSenderAllowlist(providerConfig.triggerSenderAllowlist)
    if (allowlist.length > 0) {
      const sender = (envelope.message.sender?.id ?? '').toLowerCase()
      if (!allowlist.includes(sender)) {
        logger.debug(`[${requestId}] Photon sender not in allowlist, skipping`)
        return false
      }
    }

    const triggerId = providerConfig.triggerId as string | undefined
    const contentType = envelope.message.content.type

    if (!triggerId || triggerId === 'photon_imessage_message_received') {
      return !NON_MESSAGE_TYPES.has(contentType)
    }
    if (triggerId === 'photon_imessage_webhook') {
      return true
    }
    if (triggerId === 'photon_imessage_reaction_received') {
      return contentType === 'reaction'
    }
    if (triggerId === 'photon_imessage_read_receipt') {
      return contentType === 'read'
    }

    logger.debug(`[${requestId}] Unknown Photon triggerId ${triggerId}, skipping`)
    return false
  },

  /**
   * Keys MUST stay aligned with the trigger `outputs` builders in
   * `apps/sim/triggers/photon_imessage/utils.ts` — nothing type-checks that link, and a drift
   * silently empties the tag dropdown.
   */
  async formatInput({ body, webhook, requestId }: FormatInputContext): Promise<FormatInputResult> {
    const envelope = parseEnvelope(body)
    if (!envelope) {
      return { input: null, skip: { message: 'Payload is not a Photon message envelope' } }
    }

    const { message } = envelope
    const space = message.space
    const content = message.content as Record<string, unknown> & { type: string }
    const target = isRecordLike(content.target) ? content.target : undefined
    const triggerId = getProviderConfig(webhook).triggerId as string | undefined

    logger.info(`[${requestId}] Formatting Photon iMessage delivery`, {
      contentType: content.type,
      triggerId,
    })

    const common = {
      messageId: message.id,
      chatId: space.id,
      chatType: asString((space as Record<string, unknown>).type),
      timestamp: message.timestamp ?? '',
      raw: JSON.stringify(body),
    }

    if (triggerId === 'photon_imessage_reaction_received') {
      return {
        input: {
          ...common,
          emoji: asString(content.emoji),
          targetMessageId: target ? asString(target.id) : '',
          targetPreview: target ? asString(target.contentPreview) : '',
          senderId: message.sender?.id ?? '',
        },
      }
    }

    if (triggerId === 'photon_imessage_read_receipt') {
      const { chatType: _chatType, ...readCommon } = common
      return {
        input: {
          ...readCommon,
          targetMessageId: target ? asString(target.id) : '',
          readerId: message.sender?.id ?? '',
        },
      }
    }

    if (triggerId === 'photon_imessage_webhook') {
      return {
        input: {
          ...common,
          contentType: content.type,
          text: collectText(content),
          senderId: message.sender?.id ?? '',
        },
      }
    }

    return {
      input: {
        ...common,
        text: collectText(content),
        contentType: content.type,
        senderId: message.sender?.id ?? '',
        platform: message.platform ?? space.platform ?? '',
        attachments: collectAttachments(content),
      },
    }
  },

  /** Photon delivers at least once, so retries of one delivery must collapse to one run. */
  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) {
      return null
    }
    const message = body.message
    if (!isRecordLike(message)) {
      return null
    }
    const id = asString(message.id)
    return id ? `photon_imessage:${id}` : null
  },

  /**
   * Register this workflow's URL with Photon on deploy. The API returns the signing secret exactly
   * once; it is persisted into providerConfig (a system-managed field) so `verifyAuth` can check
   * deliveries without the user ever handling the secret.
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    const providerConfig = getProviderConfig(webhook)
    const projectId = providerConfig.triggerProjectId as string | undefined
    const projectSecret = providerConfig.triggerProjectSecret as string | undefined

    if (!projectId || !projectSecret) {
      throw new Error(
        'Photon project credentials are required. Enter the Project ID and Project Secret from app.photon.codes in the trigger configuration.'
      )
    }

    const webhookUrl = getNotificationUrl(webhook)

    const register = () =>
      fetch(`${PHOTON_WEBHOOKS_API_BASE}/${projectId}/webhooks/`, {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(projectId, projectSecret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ webhookUrl }),
      })

    logger.info(`[${requestId}] Registering Photon webhook`, { webhookId: webhook.id })

    let response = await register()

    if (response.status === 409) {
      // The URL is already registered — from an earlier deploy whose secret was lost with the
      // trigger. The secret is only returned at creation, so re-key it: delete the stale
      // registration and create a fresh one.
      logger.info(`[${requestId}] Photon webhook URL already registered; re-keying`)
      const listed = await photonWebhooksRequest(projectId, projectSecret, '')
      const existing = (Array.isArray(listed.body.data) ? listed.body.data : []).find(
        (record: PhotonWebhookRecord) => record.webhookUrl === webhookUrl
      ) as PhotonWebhookRecord | undefined
      if (existing?.id) {
        await photonWebhooksRequest(projectId, projectSecret, `${existing.id}/`, {
          method: 'DELETE',
        })
      }
      response = await register()
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: PhotonWebhookRecord
      succeed?: boolean
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          'Invalid Photon project credentials. Verify the Project ID and Project Secret from app.photon.codes.'
        )
      }
      if (response.status === 422) {
        throw new Error(
          `Photon rejected the webhook URL (${webhookUrl}). It must be a public HTTPS URL.`
        )
      }
      throw new Error(`Photon webhook registration failed with status ${response.status}`)
    }

    const externalId = body.data?.id
    const signingSecret = body.data?.signingSecret

    if (typeof externalId !== 'string' || !externalId.trim()) {
      throw new Error('Photon registered the webhook but returned no webhook id.')
    }
    if (typeof signingSecret !== 'string' || !signingSecret.trim()) {
      throw new Error('Photon registered the webhook but returned no signing secret.')
    }

    logger.info(`[${requestId}] Registered Photon webhook ${externalId}`)

    return {
      providerConfigUpdates: {
        externalId,
        signingSecret,
      },
    }
  },

  /** Deregister on trigger removal so Photon stops delivering to a dead URL. */
  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const projectId = providerConfig.triggerProjectId as string | undefined
      const projectSecret = providerConfig.triggerProjectSecret as string | undefined
      const externalId = providerConfig.externalId as string | undefined

      if (!projectId || !projectSecret || !externalId) {
        logger.warn(
          `[${requestId}] Missing Photon credentials or externalId for webhook ${webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Photon webhook deletion credentials')
        return
      }

      const { status } = await photonWebhooksRequest(projectId, projectSecret, `${externalId}/`, {
        method: 'DELETE',
      })

      if (status >= 400 && status !== 404) {
        logger.warn(`[${requestId}] Failed to delete Photon webhook (non-fatal): ${status}`)
        if (ctx.strict) {
          throw new Error(`Failed to delete Photon webhook: ${status}`)
        }
      } else {
        logger.info(`[${requestId}] Deleted Photon webhook ${externalId}`)
      }
    } catch (error) {
      if (ctx.strict) throw error
      logger.warn(`[${requestId}] Photon webhook cleanup failed (non-fatal)`, { error })
    }
  },
}
