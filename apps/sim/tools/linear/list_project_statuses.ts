import type {
  LinearListProjectStatusesParams,
  LinearListProjectStatusesResponse,
} from '@/tools/linear/types'
import { PAGE_INFO_OUTPUT, PROJECT_STATUS_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListProjectStatusesTool: ToolConfig<
  LinearListProjectStatusesParams,
  LinearListProjectStatusesResponse
> = {
  id: 'linear_list_project_statuses',
  name: 'Linear List Project Statuses',
  description: 'List all project statuses in Linear',
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
        query ProjectStatuses($first: Int, $after: String) {
          projectStatuses(first: $first, after: $after) {
            nodes {
              id
              name
              description
              color
              indefinite
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
        error: data.errors[0]?.message || 'Failed to list project statuses',
        output: {},
      }
    }

    const result = data.data.projectStatuses
    return {
      success: true,
      output: {
        projectStatuses: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    projectStatuses: {
      type: 'array',
      description: 'List of project statuses',
      items: {
        type: 'object',
        properties: PROJECT_STATUS_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
