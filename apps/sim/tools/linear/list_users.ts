import type { LinearListUsersParams, LinearListUsersResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListUsersTool: ToolConfig<LinearListUsersParams, LinearListUsersResponse> = {
  id: 'linear_list_users',
  name: 'Linear List Users',
  description: 'List all users in the Linear workspace',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    includeDisabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include disabled/inactive users',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of users to return (default: 50)',
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
        query ListUsers($includeDisabled: Boolean, $first: Int, $after: String) {
          users(includeDisabled: $includeDisabled, first: $first, after: $after) {
            nodes {
              id
              name
              email
              displayName
              active
              admin
              avatarUrl
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: {
        includeDisabled: params.includeDisabled || false,
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
        error: data.errors[0]?.message || 'Failed to list users',
        output: {},
      }
    }

    const result = data.data.users
    return {
      success: true,
      output: {
        users: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of workspace users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          name: { type: 'string', description: 'User name' },
          email: { type: 'string', description: 'User email' },
          displayName: { type: 'string', description: 'Display name' },
          active: { type: 'boolean', description: 'Whether user is active' },
          admin: { type: 'boolean', description: 'Whether user is admin' },
          avatarUrl: { type: 'string', description: 'Avatar URL' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
