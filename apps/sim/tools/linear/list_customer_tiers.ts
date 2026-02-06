import type {
  LinearListCustomerTiersParams,
  LinearListCustomerTiersResponse,
} from '@/tools/linear/types'
import { CUSTOMER_TIER_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT } from '@/tools/linear/types'
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

  params: {
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tiers to return (default: 50)',
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
        query CustomerTiers($first: Int, $after: String) {
          customerTiers(first: $first, after: $after) {
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
        error: data.errors[0]?.message || 'Failed to list customer tiers',
        output: {},
      }
    }

    const result = data.data.customerTiers
    return {
      success: true,
      output: {
        customerTiers: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    customerTiers: {
      type: 'array',
      description: 'List of customer tiers',
      items: {
        type: 'object',
        properties: CUSTOMER_TIER_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
