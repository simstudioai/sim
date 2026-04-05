import { createLogger } from '@sim/logger'
import type { EventFilterContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Webflow')

export const webflowHandler: WebhookProviderHandler = {
  shouldSkipEvent({ webhook, body, requestId, providerConfig }: EventFilterContext) {
    const configuredCollectionId = providerConfig.collectionId as string | undefined
    if (configuredCollectionId) {
      const obj = body as Record<string, unknown>
      const payload = obj.payload as Record<string, unknown> | undefined
      const payloadCollectionId = (payload?.collectionId ?? obj.collectionId) as string | undefined

      if (payloadCollectionId && payloadCollectionId !== configuredCollectionId) {
        logger.info(
          `[${requestId}] Webflow collection '${payloadCollectionId}' doesn't match configured collection '${configuredCollectionId}' for webhook ${webhook.id as string}, skipping`
        )
        return true
      }
    }
    return false
  },
}
