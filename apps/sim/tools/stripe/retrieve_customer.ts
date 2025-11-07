import type { CustomerResponse, RetrieveCustomerParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeRetrieveCustomerTool: ToolConfig<RetrieveCustomerParams, CustomerResponse> = {
  id: 'stripe_retrieve_customer',
  name: 'Stripe Retrieve Customer',
  description: 'Retrieve an existing customer by ID',
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
      description: 'Customer ID (e.g., cus_1234567890)',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/customers/${params.id}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        customer: data,
        metadata: {
          id: data.id,
          email: data.email,
          name: data.name,
        },
      },
    }
  },

  outputs: {
    customer: {
      type: 'json',
      description: 'The retrieved customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
    },
  },
}
