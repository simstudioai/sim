import type { CustomerDeleteResponse, DeleteCustomerParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeDeleteCustomerTool: ToolConfig<DeleteCustomerParams, CustomerDeleteResponse> = {
  id: 'stripe_delete_customer',
  name: 'Stripe Delete Customer',
  description: 'Permanently delete a customer',
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
    method: 'DELETE',
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
        deleted: data.deleted,
        id: data.id,
        metadata: {
          id: data.id,
          deleted: data.deleted,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the customer was deleted',
    },
    id: {
      type: 'string',
      description: 'The ID of the deleted customer',
    },
    metadata: {
      type: 'json',
      description: 'Deletion metadata',
    },
  },
}
