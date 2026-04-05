import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Typeform')

function validateTypeformSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      return false
    }
    if (!signature.startsWith('sha256=')) {
      return false
    }
    const providedSignature = signature.substring(7)
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Typeform signature:', error)
    return false
  }
}

export const typeformHandler: WebhookProviderHandler = {
  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const formResponse = (b?.form_response || {}) as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const includeDefinition = providerConfig.includeDefinition === true
    return {
      input: {
        event_id: b?.event_id || '',
        event_type: b?.event_type || 'form_response',
        form_id: formResponse.form_id || '',
        token: formResponse.token || '',
        submitted_at: formResponse.submitted_at || '',
        landed_at: formResponse.landed_at || '',
        calculated: formResponse.calculated || {},
        variables: formResponse.variables || [],
        hidden: formResponse.hidden || {},
        answers: formResponse.answers || [],
        ...(includeDefinition ? { definition: formResponse.definition || {} } : {}),
        ending: formResponse.ending || {},
        raw: b,
      },
    }
  },

  verifyAuth: createHmacVerifier({
    configKey: 'secret',
    headerName: 'Typeform-Signature',
    validateFn: validateTypeformSignature,
    providerLabel: 'Typeform',
  }),
}
