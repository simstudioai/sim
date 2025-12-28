import Stripe from 'stripe'
import type { ListSubscriptionsParams, SubscriptionListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Subscriptions Tool
 * Uses official stripe SDK for subscription listing with pagination and filtering
 */

export const stripeListSubscriptionsTool: ToolConfig<
  ListSubscriptionsParams,
  SubscriptionListResponse
> = {
  id: 'stripe_list_subscriptions',
  name: 'Stripe List Subscriptions',
  description: 'List all subscriptions',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by customer ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by status (active, past_due, unpaid, canceled, incomplete, incomplete_expired, trialing, all)',
    },
    price: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by price ID',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Lists subscriptions with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare list options
      const listOptions: Stripe.SubscriptionListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.customer) listOptions.customer = params.customer
      if (params.status) listOptions.status = params.status as Stripe.SubscriptionListParams.Status
      if (params.price) listOptions.price = params.price

      // List subscriptions using SDK
      const subscriptionList = await stripe.subscriptions.list(listOptions)

      return {
        success: true,
        output: {
          subscriptions: subscriptionList.data || [],
          metadata: {
            count: subscriptionList.data.length,
            has_more: subscriptionList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_LIST_SUBSCRIPTIONS_ERROR',
          message: error.message || 'Failed to list subscriptions',
          details: error,
        },
      }
    }
  },

  outputs: {
    subscriptions: {
      type: 'json',
      description: 'Array of subscription objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
