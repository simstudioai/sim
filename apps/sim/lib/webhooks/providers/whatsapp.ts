import { createLogger } from '@sim/logger'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:WhatsApp')

export const whatsappHandler: WebhookProviderHandler = {
  handleEmptyInput(requestId: string) {
    logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)
    return { message: 'No messages in WhatsApp payload' }
  },
}
