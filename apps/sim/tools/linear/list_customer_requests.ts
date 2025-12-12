import type {
  LinearListCustomerRequestsParams,
  LinearListCustomerRequestsResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListCustomerRequestsTool: ToolConfig<
  LinearListCustomerRequestsParams,
  LinearListCustomerRequestsResponse
> = {
  id: 'linear_list_customer_requests',
  name: 'Linear List Customer Requests',
  description: 'List all customer requests (needs) in Linear',
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
      description: 'Number of customer requests to return (default: 50)',
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
      description: 'Include archived customer requests (default: false)',
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
        query ListCustomerNeeds($first: Int, $after: String, $includeArchived: Boolean) {
          customerNeeds(first: $first, after: $after, includeArchived: $includeArchived) {
            nodes {
              id
              body
              priority
              createdAt
              updatedAt
              archivedAt
              customer {
                id
                name
              }
              issue {
                id
                title
              }
              project {
                id
                name
              }
              creator {
                id
                name
              }
              url
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
        error: data.errors[0]?.message || 'Failed to list customer requests',
        output: {},
      }
    }

    const result = data.data.customerNeeds
    return {
      success: true,
      output: {
        customerNeeds: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    customerNeeds: {
      type: 'array',
      description: 'Array of customer requests',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Customer request ID' },
          body: { type: 'string', description: 'Request description' },
          priority: {
            type: 'number',
            description: 'Urgency level (0 = Not important, 1 = Important)',
          },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
          archivedAt: { type: 'string', description: 'Archive timestamp (null if not archived)' },
          customer: { type: 'object', description: 'Assigned customer' },
          issue: { type: 'object', description: 'Linked issue (null if not linked)' },
          project: { type: 'object', description: 'Linked project (null if not linked)' },
          creator: { type: 'object', description: 'User who created the request' },
          url: { type: 'string', description: 'URL to the customer request' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
