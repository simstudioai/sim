import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Calcom')

function validateCalcomSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Cal.com signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    let providedSignature: string
    if (signature.startsWith('sha256=')) {
      providedSignature = signature.substring(7)
    } else {
      providedSignature = signature
    }
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    logger.debug('Cal.com signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Cal.com signature:', error)
    return false
  }
}

export const calcomHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Cal-Signature-256',
    validateFn: validateCalcomSignature,
    providerLabel: 'Cal.com',
  }),
}
