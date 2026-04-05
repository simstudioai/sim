import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateLinearSignature } from '@/lib/webhooks/utils.server'

export const linearHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'Linear-Signature',
    validateFn: validateLinearSignature,
    providerLabel: 'Linear',
  }),

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const data = obj.data as Record<string, unknown> | undefined
    if (obj.action && data?.id) {
      return `${obj.action}:${data.id}`
    }
    return null
  },
}
