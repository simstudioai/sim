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

/**
 * Stripe SDK instance used solely for `webhooks.constructEvent`. The API key is
 * irrelevant for signature verification, but the constructor requires a value.
 */
const stripeClient = new Stripe('sk_webhook_verification_only', {
  apiVersion: '2025-08-27.basil',
})

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
      stripeClient.webhooks.constructEvent(rawBody, signature, secret)
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
