import type {
  LinearDeleteCustomerTierParams,
  LinearDeleteCustomerTierResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteCustomerTierTool: ToolConfig<
  LinearDeleteCustomerTierParams,
  LinearDeleteCustomerTierResponse
> = {
  id: 'linear_delete_customer_tier',
  name: 'Linear Delete Customer Tier',
  description: 'Delete a customer tier in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    tierId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer tier ID to delete',
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
        mutation CustomerTierDelete($id: String!) {
          customerTierDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.tierId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete customer tier',
        output: {},
      }
    }

    const result = data.data.customerTierDelete
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
