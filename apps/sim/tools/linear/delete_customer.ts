import type { LinearDeleteCustomerParams, LinearDeleteCustomerResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteCustomerTool: ToolConfig<
  LinearDeleteCustomerParams,
  LinearDeleteCustomerResponse
> = {
  id: 'linear_delete_customer',
  name: 'Linear Delete Customer',
  description: 'Delete a customer in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to delete',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        mutation CustomerDelete($id: String!) {
          customerDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.customerId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete customer',
        output: {},
      }
    }

    const result = data.data.customerDelete
    return {
      success: result.success,
      output: {
        success: result.success,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the deletion was successful',
    },
  },
}
