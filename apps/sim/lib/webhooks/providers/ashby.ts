import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateAshbySignature } from '@/lib/webhooks/utils.server'

export const ashbyHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'secretToken',
    headerName: 'ashby-signature',
    validateFn: validateAshbySignature,
    providerLabel: 'Ashby',
  }),
}
