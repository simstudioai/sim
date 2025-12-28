import Stripe from 'stripe'
import type { RetrieveSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Subscription Tool
 * Uses official stripe SDK for subscription retrieval
 */

export const stripeRetrieveSubscriptionTool: ToolConfig<
  RetrieveSubscriptionParams,
  SubscriptionResponse
> = {
  id: 'stripe_retrieve_subscription',
  name: 'Stripe Retrieve Subscription',
  description: 'Retrieve an existing subscription by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subscription ID (e.g., sub_1234567890)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Retrieves subscription by ID with full subscription data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Retrieve subscription using SDK
      const subscription = await stripe.subscriptions.retrieve(params.id)

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
          code: 'STRIPE_RETRIEVE_SUBSCRIPTION_ERROR',
          message: error.message || 'Failed to retrieve subscription',
          details: error,
        },
      }
    }
  },

  outputs: {
    subscription: {
      type: 'json',
      description: 'The retrieved subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
