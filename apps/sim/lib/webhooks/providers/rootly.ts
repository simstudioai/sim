import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { generateId } from '@sim/utils/id'
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

const logger = createLogger('WebhookProvider:Rootly')

const ROOTLY_WEBHOOK_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

/**
 * Parse a Rootly `X-Rootly-Signature` header of the form
 * `t=<unix-seconds>,v1=<hex-hmac>` into its timestamp and signature parts.
 */
function parseRootlySignatureHeader(
  header: string
): { timestamp: string; signature: string } | null {
  let timestamp: string | undefined
  let signature: string | undefined
  for (const part of header.split(',')) {
    const [key, value] = part.split('=')
    if (key?.trim() === 't') timestamp = value?.trim()
    else if (key?.trim() === 'v1') signature = value?.trim()
  }
  if (!timestamp || !signature) return null
  return { timestamp, signature }
}

/**
 * Validate a Rootly webhook signature. Rootly signs the concatenation of the
 * header timestamp and the raw request body with HMAC-SHA256 (hex digest).
 * See https://docs.rootly.com/configuration/webhooks.
 */
function validateRootlySignature(
  secret: string,
  timestamp: string,
  signature: string,
  body: string
): boolean {
  try {
    if (!secret || !timestamp || !signature || !body) return false
    const computed = hmacSha256Hex(`${timestamp}${body}`, secret)
    return safeCompare(computed, signature)
  } catch (error) {
    logger.error('Error validating Rootly signature:', error)
    return false
  }
}

export const rootlyHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      return null
    }

    const header = request.headers.get('X-Rootly-Signature')
    if (!header) {
      logger.warn(`[${requestId}] Rootly webhook missing signature header`)
      return new NextResponse('Unauthorized - Missing Rootly signature', { status: 401 })
    }

    const parsed = parseRootlySignatureHeader(header)
    if (!parsed) {
      logger.warn(`[${requestId}] Rootly signature header malformed`)
      return new NextResponse('Unauthorized - Malformed Rootly signature', { status: 401 })
    }

    if (!validateRootlySignature(secret, parsed.timestamp, parsed.signature, rawBody)) {
      logger.warn(`[${requestId}] Rootly signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Rootly signature', { status: 401 })
    }

    const tsSeconds = Number(parsed.timestamp)
    if (!Number.isFinite(tsSeconds)) {
      logger.warn(`[${requestId}] Rootly signature timestamp invalid`)
      return new NextResponse('Unauthorized - Invalid Rootly timestamp', { status: 401 })
    }
    if (Math.abs(Date.now() - tsSeconds * 1000) > ROOTLY_WEBHOOK_TIMESTAMP_SKEW_MS) {
      logger.warn(`[${requestId}] Rootly signature timestamp outside allowed skew`)
      return new NextResponse('Unauthorized - Rootly timestamp skew too large', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId && triggerId !== 'rootly_webhook') {
      const { isRootlyEventMatch } = await import('@/triggers/rootly/utils')
      const event = (body as Record<string, unknown>)?.event as Record<string, unknown> | undefined
      const eventType = typeof event?.type === 'string' ? event.type : ''
      if (!isRootlyEventMatch(triggerId, eventType)) {
        logger.debug(
          `[${requestId}] Rootly event mismatch for trigger ${triggerId}. Type: ${eventType}. Skipping.`
        )
        return false
      }
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const event = (b?.event || {}) as Record<string, unknown>
    return {
      input: {
        eventId: event.id || '',
        eventType: event.type || '',
        issuedAt: event.issued_at || '',
        data: b?.data || null,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const event = (body as Record<string, unknown>)?.event as Record<string, unknown> | undefined
    return typeof event?.id === 'string' && event.id ? event.id : null
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const providerConfig = getProviderConfig(ctx.webhook)
      const { apiKey, triggerId } = providerConfig as {
        apiKey?: string
        triggerId?: string
      }

      if (!apiKey) {
        throw new Error(
          'Rootly API key is required. Please provide your Rootly API key in the trigger configuration.'
        )
      }

      const { rootlyEventTypesForTrigger } = await import('@/triggers/rootly/utils')
      const eventTypes = rootlyEventTypesForTrigger(triggerId)
      const notificationUrl = getNotificationUrl(ctx.webhook)

      const signingSecret = generateId()

      logger.info(`[${ctx.requestId}] Creating Rootly webhook endpoint`, {
        triggerId,
        eventTypes,
        webhookId: ctx.webhook.id,
      })

      const requestBody = {
        data: {
          type: 'webhooks_endpoints',
          attributes: {
            name: `Sim (${triggerId || 'rootly'})`,
            url: notificationUrl,
            secret: signingSecret,
            event_types: eventTypes,
            enabled: true,
          },
        },
      }

      const response = await fetch('https://api.rootly.com/v1/webhooks/endpoints', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>

      if (!response.ok) {
        const errors = responseBody.errors as Array<Record<string, unknown>> | undefined
        const errorDetail =
          (errors?.[0]?.detail as string | undefined) ||
          (errors?.[0]?.title as string | undefined) ||
          (responseBody.error as string | undefined)

        let userFriendlyMessage = 'Failed to create Rootly webhook endpoint'
        if (response.status === 401) {
          userFriendlyMessage = 'Invalid Rootly API key. Please verify your API key is correct.'
        } else if (response.status === 403) {
          userFriendlyMessage =
            'Access denied. Please ensure your Rootly API key has permission to manage webhooks.'
        } else if (errorDetail) {
          userFriendlyMessage = `Rootly error: ${errorDetail}`
        }

        logger.error(
          `[${ctx.requestId}] Failed to create Rootly webhook endpoint for webhook ${ctx.webhook.id}. Status: ${response.status}`,
          { response: responseBody }
        )
        throw new Error(userFriendlyMessage)
      }

      const data = responseBody.data as Record<string, unknown> | undefined
      const externalId = data?.id as string | undefined
      if (!externalId) {
        throw new Error('Rootly webhook endpoint created but no endpoint ID was returned')
      }

      logger.info(
        `[${ctx.requestId}] Successfully created Rootly webhook endpoint ${externalId} for webhook ${ctx.webhook.id}`
      )
      return { providerConfigUpdates: { externalId, webhookSecret: signingSecret } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${ctx.requestId}] Exception during Rootly webhook creation for webhook ${ctx.webhook.id}.`,
        {
          message: err.message,
          stack: err.stack,
        }
      )
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey) {
        logger.warn(
          `[${ctx.requestId}] Missing apiKey for Rootly webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Rootly apiKey for webhook deletion')
        return
      }

      if (!externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing externalId for Rootly webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Rootly externalId for webhook deletion')
        return
      }

      const response = await fetch(`https://api.rootly.com/v1/webhooks/endpoints/${externalId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.api+json',
        },
      })

      if (response.ok || response.status === 404) {
        await response.body?.cancel()
        logger.info(
          `[${ctx.requestId}] Deleted Rootly webhook endpoint ${externalId} (status ${response.status})`
        )
      } else {
        const responseBody = await response.json().catch(() => ({}))
        logger.warn(
          `[${ctx.requestId}] Failed to delete Rootly webhook endpoint (non-fatal): ${response.status}`,
          { response: responseBody }
        )
        if (ctx.strict) {
          throw new Error(`Failed to delete Rootly webhook endpoint: ${response.status}`)
        }
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Rootly webhook (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },
}
