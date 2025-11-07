import type {
  LinearListCustomerStatusesParams,
  LinearListCustomerStatusesResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListCustomerStatusesTool: ToolConfig<
  LinearListCustomerStatusesParams,
  LinearListCustomerStatusesResponse
> = {
  id: 'linear_list_customer_statuses',
  name: 'Linear List Customer Statuses',
  description: 'List all customer statuses in Linear',
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
        query CustomerStatuses {
          customerStatuses {
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
        error: data.errors[0]?.message || 'Failed to list customer statuses',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        customerStatuses: data.data.customerStatuses.nodes,
      },
    }
  },

  outputs: {
    customerStatuses: {
      type: 'array',
      description: 'List of customer statuses',
    },
  },
}
