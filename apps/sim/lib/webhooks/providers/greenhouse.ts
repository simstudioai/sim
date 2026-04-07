import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Greenhouse')

/**
 * Validates the Greenhouse HMAC-SHA256 signature.
 * Greenhouse sends: `Signature: sha256 <hexdigest>`
 */
function validateGreenhouseSignature(secretKey: string, signature: string, body: string): boolean {
  try {
    if (!secretKey || !signature || !body) {
      return false
    }
    const prefix = 'sha256 '
    if (!signature.startsWith(prefix)) {
      return false
    }
    const providedDigest = signature.substring(prefix.length)
    const computedDigest = crypto.createHmac('sha256', secretKey).update(body, 'utf8').digest('hex')
    return safeCompare(computedDigest, providedDigest)
  } catch {
    logger.error('Error validating Greenhouse signature')
    return false
  }
}

export const greenhouseHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'secretKey',
    headerName: 'signature',
    validateFn: validateGreenhouseSignature,
    providerLabel: 'Greenhouse',
  }),

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        action: b.action,
        payload: b.payload || {},
      },
    }
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const b = body as Record<string, unknown>
    const action = b.action as string | undefined

    if (triggerId && triggerId !== 'greenhouse_webhook') {
      const { isGreenhouseEventMatch } = await import('@/triggers/greenhouse/utils')
      if (!isGreenhouseEventMatch(triggerId, action || '')) {
        logger.debug(
          `[${requestId}] Greenhouse event mismatch for trigger ${triggerId}. Action: ${action}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedAction: action,
          }
        )

        return false
      }
    }

    return true
  },

  /**
   * Fallback when Greenhouse-Event-ID is not available on headers (see idempotency service).
   * Prefer stable resource keys; offer events include version for new versions.
   */
  extractIdempotencyId(body: unknown) {
    const b = body as Record<string, unknown>
    const action = typeof b.action === 'string' ? b.action : ''
    const payload = (b.payload || {}) as Record<string, unknown>

    const application = (payload.application || {}) as Record<string, unknown>
    const appId = application.id
    if (appId !== undefined && appId !== null && appId !== '') {
      return `greenhouse:${action}:application:${String(appId)}`
    }

    const offerId = payload.id
    const offerVersion = payload.version
    if (offerId !== undefined && offerId !== null && offerId !== '') {
      const v = offerVersion !== undefined && offerVersion !== null ? String(offerVersion) : '0'
      return `greenhouse:${action}:offer:${String(offerId)}:${v}`
    }

    const offer = (payload.offer || {}) as Record<string, unknown>
    const nestedOfferId = offer.id
    if (nestedOfferId !== undefined && nestedOfferId !== null && nestedOfferId !== '') {
      const nestedVersion =
        offer.version !== undefined && offer.version !== null ? String(offer.version) : '0'
      return `greenhouse:${action}:offer:${String(nestedOfferId)}:${nestedVersion}`
    }

    const job = (payload.job || {}) as Record<string, unknown>
    const jobId = job.id
    if (jobId !== undefined && jobId !== null && jobId !== '') {
      return `greenhouse:${action}:job:${String(jobId)}`
    }

    return null
  },
}
