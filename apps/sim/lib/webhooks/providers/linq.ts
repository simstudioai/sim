import { createLogger } from '@sim/logger'
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
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'
import { LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import { LINQ_ALL_WEBHOOK_EVENT_TYPES, LINQ_TRIGGER_TO_EVENT_TYPE } from '@/triggers/linq/utils'

const logger = createLogger('WebhookProvider:Linq')

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

    const failure = verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: signingSecret,
      providerLabel: 'Linq',
    })
    if (failure) return failure

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
    const apiKey = providerConfig.triggerApiKey as string | undefined
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

    const phoneNumbers = parsePhoneNumbers(providerConfig.triggerPhoneNumbers)
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
      const apiKey = config.triggerApiKey as string | undefined
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
