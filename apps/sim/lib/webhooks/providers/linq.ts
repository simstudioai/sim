import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import { LINQ_ALL_WEBHOOK_EVENT_TYPES, LINQ_TRIGGER_TO_EVENT_TYPE } from '@/triggers/linq/utils'

const logger = createLogger('WebhookProvider:Linq')

/** Max clock skew tolerated between the webhook timestamp and now (seconds). */
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60

/**
 * Verify a Linq webhook signature using the Standard Webhooks scheme.
 * Linq signs `${webhook-id}.${webhook-timestamp}.${rawBody}` with HMAC-SHA256 using
 * the base64-decoded `whsec_...` signing secret, and delivers the result as one or
 * more space-separated `v1,<base64>` signatures in the `webhook-signature` header.
 */
function verifyLinqSignature(
  secret: string,
  msgId: string,
  timestamp: string,
  signatures: string,
  rawBody: string
): boolean {
  try {
    const ts = Number.parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Number.isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
      return false
    }

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const toSign = `${msgId}.${timestamp}.${rawBody}`
    const expectedSignature = hmacSha256Base64(toSign, secretBytes)

    for (const versionedSig of signatures.split(' ')) {
      const parts = versionedSig.split(',')
      if (parts.length !== 2) continue
      if (safeCompare(parts[1], expectedSignature)) {
        return true
      }
    }
    return false
  } catch (error) {
    logger.error('Error verifying Linq webhook signature:', error)
    return false
  }
}

/** Parse a comma/whitespace-separated list of phone numbers into a clean array. */
function parsePhoneNumbers(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export const linqHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) {
      logger.warn(`[${requestId}] Linq webhook missing signing secret in provider configuration`)
      return new NextResponse('Unauthorized - Linq signing secret is required', { status: 401 })
    }

    const webhookId = request.headers.get('webhook-id')
    const webhookTimestamp = request.headers.get('webhook-timestamp')
    const webhookSignature = request.headers.get('webhook-signature')

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      logger.warn(`[${requestId}] Linq webhook missing Standard Webhooks signature headers`)
      return new NextResponse('Unauthorized - Missing Linq signature headers', { status: 401 })
    }

    if (
      !verifyLinqSignature(signingSecret, webhookId, webhookTimestamp, webhookSignature, rawBody)
    ) {
      logger.warn(`[${requestId}] Linq webhook signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Linq signature', { status: 401 })
    }

    return null
  },

  matchEvent({ body, providerConfig, requestId }: EventMatchContext): boolean {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'linq_webhook') {
      return true
    }

    const expectedType = LINQ_TRIGGER_TO_EVENT_TYPE[triggerId]
    if (!expectedType) {
      logger.debug(`[${requestId}] Unknown Linq triggerId ${triggerId}, skipping.`)
      return false
    }

    const actualType = (body as Record<string, unknown>)?.event_type as string | undefined
    if (actualType !== expectedType) {
      logger.debug(
        `[${requestId}] Linq event type mismatch: expected ${expectedType}, got ${actualType}. Skipping.`
      )
      return false
    }

    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = body as Record<string, unknown>
    return {
      input: {
        eventType: payload.event_type ?? null,
        eventId: payload.event_id ?? null,
        createdAt: payload.created_at ?? null,
        webhookVersion: payload.webhook_version ?? null,
        data: payload.data ?? null,
      },
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    const eventId = (body as Record<string, unknown>)?.event_id
    return typeof eventId === 'string' && eventId.length > 0 ? eventId : null
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    const providerConfig = getProviderConfig(webhook)
    const apiKey = providerConfig.apiKey as string | undefined
    const triggerId = providerConfig.triggerId as string | undefined

    if (!apiKey) {
      logger.warn(`[${requestId}] Missing apiKey for Linq webhook creation.`, {
        webhookId: webhook.id,
      })
      throw new Error(
        'Linq API Key is required. Please provide your Linq API Key in the trigger configuration.'
      )
    }

    const events =
      triggerId === 'linq_webhook'
        ? LINQ_ALL_WEBHOOK_EVENT_TYPES
        : triggerId && LINQ_TRIGGER_TO_EVENT_TYPE[triggerId]
          ? [LINQ_TRIGGER_TO_EVENT_TYPE[triggerId]]
          : null

    if (!events?.length) {
      throw new Error(`Unknown or unsupported Linq trigger type: ${triggerId ?? '(missing)'}`)
    }

    const phoneNumbers = parsePhoneNumbers(providerConfig.phoneNumbers)
    const requestBody: Record<string, unknown> = {
      target_url: getNotificationUrl(webhook),
      subscribed_events: events,
    }
    if (phoneNumbers.length > 0) {
      requestBody.phone_numbers = phoneNumbers
    }

    logger.info(`[${requestId}] Creating Linq webhook subscription`, {
      triggerId,
      events,
      webhookId: webhook.id,
    })

    const response = await fetch(`${LINQ_API_BASE}/webhook-subscriptions`, {
      method: 'POST',
      headers: linqHeaders(apiKey),
      body: JSON.stringify(requestBody),
    })

    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>

    if (!response.ok) {
      const errorMessage =
        ((responseBody.error as Record<string, unknown>)?.message as string) ||
        (responseBody.message as string) ||
        'Unknown Linq API error'
      logger.error(
        `[${requestId}] Failed to create Linq webhook subscription for webhook ${webhook.id}. Status: ${response.status}`,
        { message: errorMessage }
      )

      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid Linq API Key. Please verify your API Key is correct.')
      }
      throw new Error(`Linq error: ${errorMessage}`)
    }

    const externalId = responseBody.id
    const signingSecret = responseBody.signing_secret

    if (typeof externalId !== 'string' || !externalId.trim()) {
      throw new Error('Linq webhook was created but the API response did not include a webhook id.')
    }
    if (typeof signingSecret !== 'string' || !signingSecret.trim()) {
      throw new Error(
        'Linq webhook was created but the API response did not include a signing secret.'
      )
    }

    logger.info(`[${requestId}] Successfully created Linq webhook subscription ${externalId}.`)

    return {
      providerConfigUpdates: {
        externalId,
        signingSecret,
      },
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const config = getProviderConfig(webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(
          `[${requestId}] Missing apiKey or externalId for Linq webhook deletion ${webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Linq webhook deletion credentials')
        return
      }

      const response = await fetch(`${LINQ_API_BASE}/webhook-subscriptions/${externalId}`, {
        method: 'DELETE',
        headers: linqHeaders(apiKey),
      })

      if (!response.ok && response.status !== 404) {
        logger.warn(
          `[${requestId}] Failed to delete Linq webhook subscription (non-fatal): ${response.status}`
        )
        if (ctx.strict) {
          throw new Error(`Failed to delete Linq webhook subscription: ${response.status}`)
        }
      } else {
        logger.info(`[${requestId}] Successfully deleted Linq webhook subscription ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Linq webhook subscription (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },
}
