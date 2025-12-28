import Stripe from 'stripe'
import type { CancelSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Cancel Subscription Tool
 * Uses official stripe SDK to cancel subscriptions
 */

export const stripeCancelSubscriptionTool: ToolConfig<
  CancelSubscriptionParams,
  SubscriptionResponse
> = {
  id: 'stripe_cancel_subscription',
  name: 'Stripe Cancel Subscription',
  description: 'Cancel a subscription',
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
    prorate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to prorate the cancellation',
    },
    invoice_now: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to invoice immediately',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Cancels subscription with optional proration and invoicing
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare cancel options
      const cancelOptions: Stripe.SubscriptionDeleteParams = {}
      if (params.prorate !== undefined) cancelOptions.prorate = params.prorate
      if (params.invoice_now !== undefined) cancelOptions.invoice_now = params.invoice_now

      // Cancel subscription using SDK (uses delete method)
      const subscription = await stripe.subscriptions.cancel(params.id, cancelOptions)

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
          code: 'STRIPE_CANCEL_SUBSCRIPTION_ERROR',
          message: error.message || 'Failed to cancel subscription',
          details: error,
        },
      }
    }
  },

  outputs: {
    subscription: {
      type: 'json',
      description: 'The canceled subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
