import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Fireflies')

function validateFirefliesSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Fireflies signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    if (!signature.startsWith('sha256=')) {
      logger.warn('Fireflies signature has invalid format (expected sha256=)', {
        signaturePrefix: signature.substring(0, 10),
      })
      return false
    }
    const providedSignature = signature.substring(7)
    const computedHash = hmacSha256Hex(body, secret)
    logger.debug('Fireflies signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Fireflies signature:', error)
    return false
  }
}

export const firefliesHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>

    // Fireflies V2 webhooks use snake_case field names and "event" instead of "eventType".
    // Both meeting_id and event are required in every V2 payload, so AND is the correct check.
    const isV2 = typeof b.meeting_id === 'string' && typeof b.event === 'string'

    const meetingId = ((isV2 ? b.meeting_id : b.meetingId) || '') as string
    const eventType = ((isV2 ? b.event : b.eventType) || 'Transcription completed') as string
    const clientReferenceId = ((isV2 ? b.client_reference_id : b.clientReferenceId) || '') as string
    const rawTimestamp = b.timestamp != null ? Number(b.timestamp) : null
    const timestamp = rawTimestamp !== null && Number.isFinite(rawTimestamp) ? rawTimestamp : null

    return {
      input: {
        meetingId,
        eventType,
        clientReferenceId,
        ...(timestamp !== null ? { timestamp } : {}),
      },
    }
  },

  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'x-hub-signature',
    validateFn: validateFirefliesSignature,
    providerLabel: 'Fireflies',
  }),
}
