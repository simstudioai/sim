import { createLogger } from '@sim/logger'
import type { AuthContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Telegram')

export const telegramHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId }: AuthContext) {
    const userAgent = request.headers.get('user-agent')
    if (!userAgent) {
      logger.warn(
        `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
      )
    }
    return null
  },
}
