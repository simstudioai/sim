import Stripe from 'stripe'
import type { CreateSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Subscription Tool
 * Uses official stripe SDK for subscription creation
 */
export const stripeCreateSubscriptionTool: ToolConfig<
  CreateSubscriptionParams,
  SubscriptionResponse
> = {
  id: 'stripe_create_subscription',
  name: 'Stripe Create Subscription',
  description: 'Create a new subscription for a customer',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to subscribe',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of items with price IDs (e.g., [{"price": "price_xxx", "quantity": 1}])',
    },
    trial_period_days: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of trial days',
    },
    default_payment_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID',
    },
    cancel_at_period_end: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cancel subscription at period end',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs for storing additional information',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates subscription with trial support
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare subscription data
      const subscriptionData: Stripe.SubscriptionCreateParams = {
        customer: params.customer,
        items: params.items,
      }

      if (params.trial_period_days !== undefined) {
        subscriptionData.trial_period_days = params.trial_period_days
      }
      if (params.default_payment_method) {
        subscriptionData.default_payment_method = params.default_payment_method
      }
      if (params.cancel_at_period_end !== undefined) {
        subscriptionData.cancel_at_period_end = params.cancel_at_period_end
      }
      if (params.metadata) subscriptionData.metadata = params.metadata

      // Create subscription using SDK
      const subscription = await stripe.subscriptions.create(subscriptionData)

      return {
        success: true,
        output: {
          subscription,
          metadata: {
            id: subscription.id,
            status: subscription.status,
            customer: subscription.customer as string,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_SUBSCRIPTION_ERROR',
          message: error.message || 'Failed to create subscription',
          details: error,
        },
      }
    }
  },

  outputs: {
    subscription: {
      type: 'json',
      description: 'The created subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
