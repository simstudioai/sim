import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { skipByEventTypes } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Stripe')

export const stripeHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      logger.warn(
        `[${requestId}] Stripe webhook missing webhookSecret in providerConfig — rejecting request`
      )
      return new NextResponse('Unauthorized - Webhook secret not configured', { status: 401 })
    }

    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      logger.warn(`[${requestId}] Stripe webhook missing Stripe-Signature header`)
      return new NextResponse('Unauthorized - Missing Stripe signature', { status: 401 })
    }

    try {
      Stripe.webhooks.constructEvent(rawBody, signature, secret)
    } catch (error) {
      logger.warn(`[${requestId}] Stripe signature verification failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return new NextResponse('Unauthorized - Invalid Stripe signature', { status: 401 })
    }

    return null
  },

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
