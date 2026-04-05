import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Typeform')

function validateTypeformSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) { return false }
    if (!signature.startsWith('sha256=')) { return false }
    const providedSignature = signature.substring(7)
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Typeform signature:', error)
    return false
  }
}

export const typeformHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'secret',
    headerName: 'Typeform-Signature',
    validateFn: validateTypeformSignature,
    providerLabel: 'Typeform',
  }),
}
