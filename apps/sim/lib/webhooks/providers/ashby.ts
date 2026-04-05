import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Ashby')

function validateAshbySignature(secretToken: string, signature: string, body: string): boolean {
  try {
    if (!secretToken || !signature || !body) { return false }
    if (!signature.startsWith('sha256=')) { return false }
    const providedSignature = signature.substring(7)
    const computedHash = crypto.createHmac('sha256', secretToken).update(body, 'utf8').digest('hex')
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Ashby signature:', error)
    return false
  }
}

export const ashbyHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'secretToken',
    headerName: 'ashby-signature',
    validateFn: validateAshbySignature,
    providerLabel: 'Ashby',
  }),
}
