import Stripe from 'stripe'
import type { SubscriptionResponse, UpdateSubscriptionParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Subscription Tool
 * Uses official stripe SDK for subscription updates
 */

export const stripeUpdateSubscriptionTool: ToolConfig<
  UpdateSubscriptionParams,
  SubscriptionResponse
> = {
  id: 'stripe_update_subscription',
  name: 'Stripe Update Subscription',
  description: 'Update an existing subscription',
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
    items: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated array of items with price IDs',
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
      description: 'Updated metadata',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Updates subscription with optional fields
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare update data
      const updateData: Stripe.SubscriptionUpdateParams = {}
      if (params.items) updateData.items = params.items
      if (params.cancel_at_period_end !== undefined) {
        updateData.cancel_at_period_end = params.cancel_at_period_end
      }
      if (params.metadata) updateData.metadata = params.metadata

      // Update subscription using SDK
      const subscription = await stripe.subscriptions.update(params.id, updateData)

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
          code: 'STRIPE_UPDATE_SUBSCRIPTION_ERROR',
          message: error.message || 'Failed to update subscription',
          details: error,
        },
      }
    }
  },

  outputs: {
    subscription: {
      type: 'json',
      description: 'The updated subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
