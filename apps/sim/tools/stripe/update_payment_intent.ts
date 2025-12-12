import type { PaymentIntentResponse, UpdatePaymentIntentParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeUpdatePaymentIntentTool: ToolConfig<
  UpdatePaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_update_payment_intent',
  name: 'Stripe Update Payment Intent',
  description: 'Update an existing Payment Intent',
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
      description: 'Payment Intent ID (e.g., pi_1234567890)',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated amount in cents',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer ID',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/payment_intents/${params.id}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.amount) formData.append('amount', Number(params.amount).toString())
      if (params.currency) formData.append('currency', params.currency)
      if (params.customer) formData.append('customer', params.customer)
      if (params.description) formData.append('description', params.description)

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
        payment_intent: data,
        metadata: {
          id: data.id,
          status: data.status,
          amount: data.amount,
          currency: data.currency,
        },
      },
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The updated Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
