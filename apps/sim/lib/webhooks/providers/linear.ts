import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Linear')

function validateLinearSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Linear signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    logger.debug('Linear signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
    return false
  }
}

export const linearHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'Linear-Signature',
    validateFn: validateLinearSignature,
    providerLabel: 'Linear',
  }),

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        action: b.action || '',
        type: b.type || '',
        webhookId: b.webhookId || '',
        webhookTimestamp: b.webhookTimestamp || 0,
        organizationId: b.organizationId || '',
        createdAt: b.createdAt || '',
        actor: b.actor || null,
        data: b.data || null,
        updatedFrom: b.updatedFrom || null,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const data = obj.data as Record<string, unknown> | undefined
    if (obj.action && data?.id) {
      return `${obj.action}:${data.id}`
    }
    return null
  },
}
