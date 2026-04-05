import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateCirclebackSignature } from '@/lib/webhooks/utils.server'

export const circlebackHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'x-signature',
    validateFn: validateCirclebackSignature,
    providerLabel: 'Circleback',
  }),
}
