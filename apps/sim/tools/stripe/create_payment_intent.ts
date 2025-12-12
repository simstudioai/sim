import type { CreatePaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCreatePaymentIntentTool: ToolConfig<
  CreatePaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_create_payment_intent',
  name: 'Stripe Create Payment Intent',
  description: 'Create a new Payment Intent to process a payment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount in cents (e.g., 2000 for $20.00)',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code (e.g., usd, eur)',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer ID to associate with this payment',
    },
    payment_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the payment',
    },
    receipt_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to send receipt to',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs for storing additional information',
    },
    automatic_payment_methods: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable automatic payment methods (e.g., {"enabled": true})',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/payment_intents',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      formData.append('amount', Number(params.amount).toString())
      formData.append('currency', params.currency)

      if (params.customer) formData.append('customer', params.customer)
      if (params.payment_method) formData.append('payment_method', params.payment_method)
      if (params.description) formData.append('description', params.description)
      if (params.receipt_email) formData.append('receipt_email', params.receipt_email)

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
      }

      if (params.automatic_payment_methods?.enabled) {
        formData.append('automatic_payment_methods[enabled]', 'true')
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
      description: 'The created Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
