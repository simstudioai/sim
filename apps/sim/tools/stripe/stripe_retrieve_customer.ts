import type { ToolConfig } from '@/tools/types'

export const stripeRetrieveCustomerTool: ToolConfig = {
  id: 'stripe_retrieve_customer',
  name: 'Retrieve Customer Details',
  description:
    'Fetches detailed information about a specific customer, including payment methods and billing history.',
  version: '1.0.0',

  params: {
    customer_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID of the Stripe Customer object.',
    },
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique customer identifier.',
    },
    email: {
      type: 'string',
      description: "Customer's email address.",
      optional: true,
    },
    address: {
      type: 'json',
      description: 'Billing address details.',
      optional: true,
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/customers/${params.customer_id}`,
    method: () => 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      id: data.id ?? '',
      email: data.email ?? '',
      address: data.address ?? null,
    }
  },
}
