import { getLoopsClient, isLoopsEnabled } from './loops-client'
import { getPlans, getPlanByName } from './plans'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('LoopsCheckout')

// Note: We use lineItems with Stripe price IDs directly instead of payment links
// Payment links are not directly supported in checkout session creation

/**
 * Creates a Loops v3 checkout session for a subscription
 */
export async function createLoopsCheckoutSession(params: {
  plan: string
  externalCustomerId: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, any>
}): Promise<{ url: string; sessionId: string }> {
  if (!isLoopsEnabled()) {
    throw new Error('Loops is not enabled. Please provide LOOPS_API_KEY in environment variables.')
  }

  const loops = getLoopsClient()
  const plan = getPlanByName(params.plan)

  if (!plan) {
    throw new Error(`Invalid plan: ${params.plan}`)
  }

  if (!plan.priceId) {
    throw new Error(`Price ID not configured for plan: ${plan.name}`)
  }

  logger.info('Creating Loops checkout session', {
    plan: plan.name,
    priceId: plan.priceId,
    externalCustomerId: params.externalCustomerId,
  })

  try {
    // Create checkout session using Loops API (v3)
    // Use lineItems with Stripe price ID since paymentLinkId is not directly supported
    const result = await loops.checkoutSessions.create({
      lineItems: [
        {
          price: plan.priceId,
          quantity: params.metadata?.seats || 1,
          ...(plan.name === 'team' && {
            adjustableQuantity: {
              enabled: true,
              minimum: 1,
              maximum: 50,
            },
          }),
        },
      ],
      mode: 'subscription',
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      externalCustomerId: params.externalCustomerId,
      metadata: {
        plan: plan.name,
        planPriceId: plan.priceId,
        ...params.metadata,
      },
    })

    logger.info('Loops checkout session created successfully', {
      sessionId: result.id,
      url: result.url,
    })

    return {
      url: result.url || '',
      sessionId: result.id || '',
    }
  } catch (error) {
    logger.error('Failed to create Loops checkout session', {
      error,
      plan: plan.name,
      priceId: plan.priceId,
    })
    throw error
  }
}

