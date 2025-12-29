import Stripe from 'stripe'
import type { ResumeSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Resume Subscription Tool
 * Uses official stripe SDK to resume scheduled cancellations
 */

export const stripeResumeSubscriptionTool: ToolConfig<
  ResumeSubscriptionParams,
  SubscriptionResponse
> = {
  id: 'stripe_resume_subscription',
  name: 'Stripe Resume Subscription',
  description: 'Resume a subscription that was scheduled for cancellation',
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
   * Resumes subscription that was scheduled for cancellation
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Resume subscription using SDK
      const subscription = await stripe.subscriptions.resume(params.id, {
        billing_cycle_anchor: 'unchanged',
      })

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
        error: `STRIPE_RESUME_SUBSCRIPTION_ERROR: Failed to resume subscription - ${errorDetails}`,
      }
    }
  },

  outputs: {
    subscription: {
      type: 'json',
      description: 'The resumed subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
