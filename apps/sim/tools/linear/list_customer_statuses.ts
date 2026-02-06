import type {
  LinearListCustomerStatusesParams,
  LinearListCustomerStatusesResponse,
} from '@/tools/linear/types'
import { CUSTOMER_STATUS_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT } from '@/tools/linear/types'
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

  params: {
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of statuses to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
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
        query CustomerStatuses($first: Int, $after: String) {
          customerStatuses(first: $first, after: $after) {
            nodes {
              id
              name
              description
              color
              position
              type
              createdAt
              updatedAt
              archivedAt
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: {
        first: params.first ? Number(params.first) : 50,
        after: params.after,
      },
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

    const result = data.data.customerStatuses
    return {
      success: true,
      output: {
        customerStatuses: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    customerStatuses: {
      type: 'array',
      description: 'List of customer statuses',
      items: {
        type: 'object',
        properties: CUSTOMER_STATUS_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
