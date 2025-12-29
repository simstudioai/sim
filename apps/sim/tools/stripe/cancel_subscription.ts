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
      visibility: 'user-only',
      description: 'Subscription ID (e.g., sub_1234567890) - requires human confirmation for cancellation',
    },
    prorate: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to prorate the cancellation - affects billing',
    },
    invoice_now: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to invoice immediately - can trigger charges',
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
        apiVersion: '2025-08-27.basil',
      })

      // Prepare cancel options
      const cancelOptions: Stripe.SubscriptionCancelParams = {}
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
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_CANCEL_SUBSCRIPTION_ERROR: Failed to cancel subscription - ${errorDetails}`,
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
