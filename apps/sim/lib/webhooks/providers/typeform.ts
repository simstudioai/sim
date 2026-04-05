import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateTypeformSignature } from '@/lib/webhooks/utils.server'

export const typeformHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'secret',
    headerName: 'Typeform-Signature',
    validateFn: validateTypeformSignature,
    providerLabel: 'Typeform',
  }),
}
