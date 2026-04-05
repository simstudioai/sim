import { createLogger } from '@sim/logger'
import type {
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { skipByEventTypes } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Stripe')

export const stripeHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },

  shouldSkipEvent(ctx: EventFilterContext) {
    return skipByEventTypes(ctx, 'Stripe', logger)
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (obj.id && obj.object === 'event') {
      return String(obj.id)
    }
    return null
  },
}
