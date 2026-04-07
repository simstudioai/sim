import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
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
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
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
    return {
      input: {
        meetingId: (b.meetingId || '') as string,
        eventType: (b.eventType || 'Transcription completed') as string,
        clientReferenceId: (b.clientReferenceId || '') as string,
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
