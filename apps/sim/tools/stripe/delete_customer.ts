import type { CustomerDeleteResponse, DeleteCustomerParams } from '@/tools/stripe/types'
import { DELETE_OUTPUT_PROPERTIES } from '@/tools/stripe/types'
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
      },
    }
  },

  outputs: {
    deleted: DELETE_OUTPUT_PROPERTIES.deleted,
    id: DELETE_OUTPUT_PROPERTIES.id,
  },
}
