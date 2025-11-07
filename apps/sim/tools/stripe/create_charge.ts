import type { ChargeResponse, CreateChargeParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCreateChargeTool: ToolConfig<CreateChargeParams, ChargeResponse> = {
  id: 'stripe_create_charge',
  name: 'Stripe Create Charge',
  description: 'Create a new charge to process a payment',
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
      description: 'Customer ID to associate with this charge',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment source ID (e.g., card token or saved card ID)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the charge',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs for storing additional information',
    },
    capture: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to immediately capture the charge (defaults to true)',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/charges',
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
      if (params.source) formData.append('source', params.source)
      if (params.description) formData.append('description', params.description)
      if (params.capture !== undefined) formData.append('capture', String(params.capture))

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
        charge: data,
        metadata: {
          id: data.id,
          status: data.status,
          amount: data.amount,
          currency: data.currency,
          paid: data.paid,
        },
      },
    }
  },

  outputs: {
    charge: {
      type: 'json',
      description: 'The created Charge object',
    },
    metadata: {
      type: 'json',
      description: 'Charge metadata including ID, status, amount, currency, and paid status',
    },
  },
}
