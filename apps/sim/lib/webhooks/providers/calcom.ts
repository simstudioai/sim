import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateCalcomSignature } from '@/lib/webhooks/utils.server'

export const calcomHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Cal-Signature-256',
    validateFn: validateCalcomSignature,
    providerLabel: 'Cal.com',
  }),
}
