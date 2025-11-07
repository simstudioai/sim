import type { LinearListCustomersParams, LinearListCustomersResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListCustomersTool: ToolConfig<
  LinearListCustomersParams,
  LinearListCustomersResponse
> = {
  id: 'linear_list_customers',
  name: 'Linear List Customers',
  description: 'List all customers in Linear',
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
      description: 'Number of customers to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived customers (default: false)',
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
        query ListCustomers($first: Int, $after: String, $includeArchived: Boolean) {
          customers(first: $first, after: $after, includeArchived: $includeArchived) {
            nodes {
              id
              name
              domains
              externalIds
              logoUrl
              approximateNeedCount
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
        first: params.first || 50,
        after: params.after,
        includeArchived: params.includeArchived || false,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list customers',
        output: {},
      }
    }

    const result = data.data.customers
    return {
      success: true,
      output: {
        customers: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    customers: {
      type: 'array',
      description: 'Array of customers',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Customer ID' },
          name: { type: 'string', description: 'Customer name' },
          domains: { type: 'array', description: 'Associated domains' },
          externalIds: { type: 'array', description: 'External IDs' },
          logoUrl: { type: 'string', description: 'Logo URL' },
          approximateNeedCount: { type: 'number', description: 'Number of customer needs' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          archivedAt: { type: 'string', description: 'Archive timestamp (null if not archived)' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
