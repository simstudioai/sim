import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { skipByEventTypes } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Grain')

export const grainHandler: WebhookProviderHandler = {
  handleReachabilityTest(body: unknown, requestId: string) {
    const obj = body as Record<string, unknown> | null
    const isVerificationRequest = !obj || Object.keys(obj).length === 0 || !obj.type
    if (isVerificationRequest) {
      logger.info(
        `[${requestId}] Grain reachability test detected - returning 200 for webhook verification`
      )
      return NextResponse.json({
        status: 'ok',
        message: 'Webhook endpoint verified',
      })
    }
    return null
  },

  shouldSkipEvent(ctx: EventFilterContext) {
    return skipByEventTypes(ctx, 'Grain', logger)
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return { input: { type: b.type, user_id: b.user_id, data: b.data || {} } }
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const data = obj.data as Record<string, unknown> | undefined
    if (obj.type && data?.id) {
      return `${obj.type}:${data.id}`
    }
    return null
  },
}
