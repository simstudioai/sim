import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Intercom')

/**
 * Validate Intercom webhook signature using HMAC-SHA1.
 * Intercom signs payloads with the app's Client Secret and sends the
 * signature in the X-Hub-Signature header as "sha1=<hex>".
 */
function validateIntercomSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Intercom signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    if (!signature.startsWith('sha1=')) {
      logger.warn('Intercom signature has invalid format', {
        signature: `${signature.substring(0, 10)}...`,
      })
      return false
    }

    const providedSignature = signature.substring(5)
    const computedHash = crypto.createHmac('sha1', secret).update(body, 'utf8').digest('hex')

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Intercom signature:', error)
    return false
  }
}

export const intercomHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      return null
    }

    const signature = request.headers.get('X-Hub-Signature')
    if (!signature) {
      logger.warn(`[${requestId}] Intercom webhook missing X-Hub-Signature header`)
      return new NextResponse('Unauthorized - Missing Intercom signature', { status: 401 })
    }

    if (!validateIntercomSignature(secret, signature, rawBody)) {
      logger.warn(`[${requestId}] Intercom signature verification failed`, {
        signatureLength: signature.length,
        secretLength: secret.length,
      })
      return new NextResponse('Unauthorized - Invalid Intercom signature', { status: 401 })
    }

    return null
  },

  handleReachabilityTest(body: unknown, requestId: string) {
    const obj = body as Record<string, unknown> | null
    if (obj?.topic === 'ping') {
      logger.info(
        `[${requestId}] Intercom ping event detected - returning 200 without triggering workflow`
      )
      return NextResponse.json({
        status: 'ok',
        message: 'Webhook endpoint verified',
      })
    }
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },

  async matchEvent({ webhook, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>
    const topic = obj?.topic as string | undefined

    if (triggerId && triggerId !== 'intercom_webhook') {
      const { isIntercomEventMatch } = await import('@/triggers/intercom/utils')
      if (!isIntercomEventMatch(triggerId, topic || '')) {
        logger.debug(
          `[${requestId}] Intercom event mismatch for trigger ${triggerId}. Topic: ${topic}. Skipping execution.`,
          {
            webhookId: webhook.id,
            triggerId,
            receivedTopic: topic,
          }
        )
        return false
      }
    }

    return true
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (obj?.id && obj?.type === 'notification_event') {
      return String(obj.id)
    }
    return null
  },
}
