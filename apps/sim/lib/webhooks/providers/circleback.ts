import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Circleback')

function validateCirclebackSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Circleback signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    const computedHash = hmacSha256Hex(body, secret)
    logger.debug('Circleback signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Circleback signature:', error)
    return false
  }
}

export const circlebackHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        id: b.id,
        name: b.name,
        createdAt: b.createdAt,
        duration: b.duration,
        url: b.url,
        recordingUrl: b.recordingUrl,
        tags: b.tags || [],
        icalUid: b.icalUid,
        attendees: b.attendees || [],
        notes: b.notes || '',
        actionItems: b.actionItems || [],
        transcript: b.transcript || [],
        insights: b.insights || {},
        meeting: b,
      },
    }
  },

  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'x-signature',
    validateFn: validateCirclebackSignature,
    providerLabel: 'Circleback',
  }),
}
