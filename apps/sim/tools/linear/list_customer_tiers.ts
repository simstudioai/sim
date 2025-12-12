import type {
  LinearListCustomerTiersParams,
  LinearListCustomerTiersResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListCustomerTiersTool: ToolConfig<
  LinearListCustomerTiersParams,
  LinearListCustomerTiersResponse
> = {
  id: 'linear_list_customer_tiers',
  name: 'Linear List Customer Tiers',
  description: 'List all customer tiers in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {},

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
    body: () => ({
      query: `
        query CustomerTiers {
          customerTiers {
            nodes {
              id
              name
              displayName
              description
              color
              position
              createdAt
              archivedAt
            }
          }
        }
      `,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list customer tiers',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        customerTiers: data.data.customerTiers.nodes,
      },
    }
  },

  outputs: {
    customerTiers: {
      type: 'array',
      description: 'List of customer tiers',
    },
  },
}
