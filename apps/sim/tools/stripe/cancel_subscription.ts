import type { CancelSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params) => `https://api.stripe.com/v1/subscriptions/${params.id}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.prorate !== undefined) {
        formData.append('prorate', String(params.prorate))
      }
      if (params.invoice_now !== undefined) {
        formData.append('invoice_now', String(params.invoice_now))
      }

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        subscription: data,
        metadata: {
          id: data.id,
          status: data.status,
          customer: data.customer,
        },
      },
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
