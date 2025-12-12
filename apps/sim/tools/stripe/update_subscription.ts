import type { SubscriptionResponse, UpdateSubscriptionParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params) => `https://api.stripe.com/v1/subscriptions/${params.id}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.items && Array.isArray(params.items)) {
        params.items.forEach((item, index) => {
          formData.append(`items[${index}][price]`, item.price)
          if (item.quantity) {
            formData.append(`items[${index}][quantity]`, String(item.quantity))
          }
        })
      }

      if (params.cancel_at_period_end !== undefined) {
        formData.append('cancel_at_period_end', String(params.cancel_at_period_end))
      }

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
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
      description: 'The updated subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
