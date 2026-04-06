import crypto from 'crypto'
import { db, webhook } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  AuthContext,
  EventMatchContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Zoom')

/**
 * Validate Zoom webhook signature using HMAC-SHA256.
 * Zoom sends `x-zm-signature` as `v0=<hex>` and `x-zm-request-timestamp`.
 * The message to hash is `v0:{timestamp}:{rawBody}`.
 */
function validateZoomSignature(
  secretToken: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  try {
    if (!secretToken || !signature || !timestamp || !body) {
      return false
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const requestSeconds = Number.parseInt(timestamp, 10)
    if (Number.isNaN(requestSeconds) || Math.abs(nowSeconds - requestSeconds) > 300) {
      return false
    }

    const message = `v0:${timestamp}:${body}`
    const computedHash = crypto.createHmac('sha256', secretToken).update(message).digest('hex')
    const expectedSignature = `v0=${computedHash}`

    return safeCompare(expectedSignature, signature)
  } catch (err) {
    logger.error('Zoom signature validation error', err)
    return false
  }
}

export const zoomHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secretToken = providerConfig.secretToken as string | undefined
    if (!secretToken) {
      logger.warn(
        `[${requestId}] Zoom webhook missing secretToken in providerConfig — rejecting request`
      )
      return new NextResponse('Unauthorized - Zoom secret token not configured', { status: 401 })
    }

    const signature = request.headers.get('x-zm-signature')
    const timestamp = request.headers.get('x-zm-request-timestamp')

    if (!signature || !timestamp) {
      logger.warn(`[${requestId}] Zoom webhook missing signature or timestamp header`)
      return new NextResponse('Unauthorized - Missing Zoom signature', { status: 401 })
    }

    if (!validateZoomSignature(secretToken, signature, timestamp, rawBody)) {
      logger.warn(`[${requestId}] Zoom webhook signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Zoom signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook: wh, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>
    const event = obj.event as string | undefined

    if (triggerId) {
      const { isZoomEventMatch } = await import('@/triggers/zoom/utils')
      if (!isZoomEventMatch(triggerId, event || '')) {
        logger.debug(
          `[${requestId}] Zoom event mismatch for trigger ${triggerId}. Event: ${event}. Skipping execution.`,
          {
            webhookId: wh.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: event,
          }
        )
        return false
      }
    }

    return true
  },

  /**
   * Handle Zoom endpoint URL validation challenges.
   * Zoom sends an `endpoint.url_validation` event with a `plainToken` that must
   * be hashed with the app's secret token and returned alongside the original token.
   */
  async handleChallenge(body: unknown, request: NextRequest, requestId: string, path: string) {
    const obj = body as Record<string, unknown> | null
    if (obj?.event !== 'endpoint.url_validation') {
      return null
    }

    const payload = obj.payload as Record<string, unknown> | undefined
    const plainToken = payload?.plainToken as string | undefined
    if (!plainToken) {
      return null
    }

    logger.info(`[${requestId}] Zoom URL validation request received for path: ${path}`)

    // Look up the webhook record to get the secret token from providerConfig
    let secretToken = ''
    try {
      const webhooks = await db
        .select()
        .from(webhook)
        .where(
          and(eq(webhook.path, path), eq(webhook.provider, 'zoom'), eq(webhook.isActive, true))
        )
      if (webhooks.length > 0) {
        const config = webhooks[0].providerConfig as Record<string, unknown> | null
        secretToken = (config?.secretToken as string) || ''
      }
    } catch (err) {
      logger.warn(`[${requestId}] Failed to look up webhook secret for Zoom validation`, err)
      return null
    }

    if (!secretToken) {
      logger.warn(
        `[${requestId}] No secret token configured for Zoom URL validation on path: ${path}`
      )
      return null
    }

    // Verify the challenge request's signature to prevent HMAC oracle attacks
    const signature = request.headers.get('x-zm-signature')
    const timestamp = request.headers.get('x-zm-request-timestamp')
    if (!signature || !timestamp) {
      logger.warn(`[${requestId}] Zoom challenge request missing signature headers — rejecting`)
      return null
    }
    const rawBody = JSON.stringify(body)
    if (!validateZoomSignature(secretToken, signature, timestamp, rawBody)) {
      logger.warn(`[${requestId}] Zoom challenge request failed signature verification`)
      return null
    }

    const hashForValidate = crypto
      .createHmac('sha256', secretToken)
      .update(plainToken)
      .digest('hex')

    return NextResponse.json({
      plainToken,
      encryptedToken: hashForValidate,
    })
  },
}
