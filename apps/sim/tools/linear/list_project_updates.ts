import type {
  LinearListProjectUpdatesParams,
  LinearListProjectUpdatesResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListProjectUpdatesTool: ToolConfig<
  LinearListProjectUpdatesParams,
  LinearListProjectUpdatesResponse
> = {
  id: 'linear_list_project_updates',
  name: 'Linear List Project Updates',
  description: 'List all status updates for a project in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of updates to return (default: 50)',
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
        query ListProjectUpdates($projectId: String!, $first: Int, $after: String) {
          project(id: $projectId) {
            projectUpdates(first: $first, after: $after) {
              nodes {
                id
                body
                health
                createdAt
                user {
                  id
                  name
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      variables: {
        projectId: params.projectId,
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
        error: data.errors[0]?.message || 'Failed to list project updates',
        output: {},
      }
    }

    const result = data.data.project.projectUpdates
    return {
      success: true,
      output: {
        updates: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    updates: {
      type: 'array',
      description: 'Array of project updates',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Update ID' },
          body: { type: 'string', description: 'Update message' },
          health: { type: 'string', description: 'Project health' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          user: { type: 'object', description: 'User who created the update' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
