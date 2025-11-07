import type { CreateSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: () => 'https://api.stripe.com/v1/subscriptions',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      formData.append('customer', params.customer)

      if (params.items && Array.isArray(params.items)) {
        params.items.forEach((item, index) => {
          formData.append(`items[${index}][price]`, item.price)
          if (item.quantity) {
            formData.append(`items[${index}][quantity]`, Number(item.quantity).toString())
          }
        })
      }

      if (params.trial_period_days !== undefined) {
        formData.append('trial_period_days', Number(params.trial_period_days).toString())
      }
      if (params.default_payment_method) {
        formData.append('default_payment_method', params.default_payment_method)
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
      description: 'The created subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
    },
  },
}
