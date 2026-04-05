import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateFirefliesSignature } from '@/lib/webhooks/utils.server'

export const firefliesHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'x-hub-signature',
    validateFn: validateFirefliesSignature,
    providerLabel: 'Fireflies',
  }),
}
