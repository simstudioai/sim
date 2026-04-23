import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
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
    const computedDigest = hmacSha256Hex(body, secretKey)
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
    const payload = (b.payload || {}) as Record<string, unknown>
    const application = (payload.application || {}) as Record<string, unknown>
    const candidate = (application.candidate || {}) as Record<string, unknown>
    const jobNested = payload.job

    let applicationId: number | null = null
    if (typeof application.id === 'number') {
      applicationId = application.id
    } else if (typeof payload.application_id === 'number') {
      applicationId = payload.application_id
    }

    const candidateId = typeof candidate.id === 'number' ? candidate.id : null

    let jobId: number | null = null
    if (
      jobNested &&
      typeof jobNested === 'object' &&
      typeof (jobNested as Record<string, unknown>).id === 'number'
    ) {
      jobId = (jobNested as Record<string, unknown>).id as number
    } else if (typeof payload.job_id === 'number') {
      jobId = payload.job_id
    }

    return {
      input: {
        action: b.action,
        applicationId,
        candidateId,
        jobId,
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
