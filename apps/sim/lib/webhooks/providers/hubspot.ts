import { createHash, createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:HubSpot')

const FIVE_MINUTES_MS = 5 * 60 * 1000

/** v1: SHA-256(clientSecret + rawBody) → hex */
function validateHubSpotV1(clientSecret: string, signature: string, rawBody: string): boolean {
  const hash = createHash('sha256')
    .update(clientSecret + rawBody, 'utf8')
    .digest('hex')
  return safeCompare(hash, signature)
}

/** v2: SHA-256(clientSecret + httpMethod + fullUrl + rawBody) → hex */
function validateHubSpotV2(
  clientSecret: string,
  signature: string,
  method: string,
  url: string,
  rawBody: string
): boolean {
  const hash = createHash('sha256')
    .update(clientSecret + method + url + rawBody, 'utf8')
    .digest('hex')
  return safeCompare(hash, signature)
}

/** v3: HMAC-SHA256(clientSecret, httpMethod + fullUrl + rawBody + timestamp) → base64 */
function validateHubSpotV3(
  clientSecret: string,
  signature: string,
  method: string,
  url: string,
  rawBody: string,
  timestamp: string
): boolean {
  const computed = createHmac('sha256', clientSecret)
    .update(method + url + rawBody + timestamp, 'utf8')
    .digest('base64')
  return safeCompare(computed, signature)
}

export const hubspotHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const clientSecret = providerConfig.clientSecret as string | undefined
    if (!clientSecret) {
      logger.warn(
        `[${requestId}] HubSpot webhook has no clientSecret stored — skipping signature verification`
      )
      return null
    }

    // v3 is identified by the presence of X-HubSpot-Signature-v3, not a version header
    const v3Signature = request.headers.get('x-hubspot-signature-v3')
    if (v3Signature) {
      // HubSpot v3 sends the timestamp in X-HubSpot-Request-Timestamp
      const timestamp = request.headers.get('x-hubspot-request-timestamp')
      if (!timestamp) {
        logger.warn(
          `[${requestId}] HubSpot webhook missing X-HubSpot-Request-Timestamp header for v3`
        )
        return new NextResponse('Unauthorized - Missing HubSpot v3 timestamp', { status: 401 })
      }
      if (Math.abs(Date.now() - Number(timestamp)) > FIVE_MINUTES_MS) {
        logger.warn(`[${requestId}] HubSpot webhook timestamp too old, possible replay attack`)
        return new NextResponse('Unauthorized - HubSpot timestamp expired', { status: 401 })
      }
      if (
        !validateHubSpotV3(
          clientSecret,
          v3Signature,
          request.method,
          request.url,
          rawBody,
          timestamp
        )
      ) {
        logger.warn(`[${requestId}] HubSpot v3 signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HubSpot signature', { status: 401 })
      }
      return null
    }

    // v1/v2 are identified by X-HubSpot-Signature-Version (defaults to v1 when absent)
    const version = (request.headers.get('x-hubspot-signature-version') ?? 'v1').toLowerCase()
    const signature = request.headers.get('x-hubspot-signature')
    if (!signature) {
      logger.warn(`[${requestId}] HubSpot webhook missing X-HubSpot-Signature header`)
      return new NextResponse('Unauthorized - Missing HubSpot signature', { status: 401 })
    }

    if (version === 'v1') {
      if (!validateHubSpotV1(clientSecret, signature, rawBody)) {
        logger.warn(`[${requestId}] HubSpot v1 signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HubSpot signature', { status: 401 })
      }
    } else if (version === 'v2') {
      if (!validateHubSpotV2(clientSecret, signature, request.method, request.url, rawBody)) {
        logger.warn(`[${requestId}] HubSpot v2 signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HubSpot signature', { status: 401 })
      }
    } else {
      logger.warn(`[${requestId}] Unknown HubSpot signature version: ${version}`)
      return new NextResponse('Unauthorized - Unknown HubSpot signature version', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId?.startsWith('hubspot_')) {
      const events = Array.isArray(body) ? body : [body]
      const firstEvent = events[0] as Record<string, unknown> | undefined
      const subscriptionType = firstEvent?.subscriptionType as string | undefined

      const { isHubSpotContactEventMatch } = await import('@/triggers/hubspot/utils')
      if (!isHubSpotContactEventMatch(triggerId, subscriptionType || '')) {
        logger.debug(
          `[${requestId}] HubSpot event mismatch for trigger ${triggerId}. Event: ${subscriptionType}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: subscriptionType,
          }
        )
        return false
      }

      logger.info(
        `[${requestId}] HubSpot event match confirmed for trigger ${triggerId}. Event: ${subscriptionType}`,
        {
          webhookId: webhook.id,
          workflowId: workflow.id,
          triggerId,
          receivedEvent: subscriptionType,
        }
      )
    }

    return true
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const events = Array.isArray(b) ? b : [b]
    const event = events[0] as Record<string, unknown> | undefined
    if (!event) {
      logger.warn('HubSpot webhook received with empty payload')
      return { input: null }
    }
    logger.info('Formatting HubSpot webhook input', {
      subscriptionType: event.subscriptionType,
      objectId: event.objectId,
      portalId: event.portalId,
    })
    return {
      input: { payload: body, provider: 'hubspot', providerConfig: webhook.providerConfig },
    }
  },

  extractIdempotencyId(body: unknown) {
    if (Array.isArray(body) && body.length > 0) {
      const first = body[0] as Record<string, unknown>
      if (first?.eventId) {
        return String(first.eventId)
      }
    }
    return null
  },
}
