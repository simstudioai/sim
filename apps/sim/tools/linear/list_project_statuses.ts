import type {
  LinearListProjectStatusesParams,
  LinearListProjectStatusesResponse,
} from '@/tools/linear/types'
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
        query ProjectStatuses {
          projectStatuses {
            nodes {
              id
              name
              description
              color
              indefinite
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
        error: data.errors[0]?.message || 'Failed to list project statuses',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        projectStatuses: data.data.projectStatuses.nodes,
      },
    }
  },

  outputs: {
    projectStatuses: {
      type: 'array',
      description: 'List of project statuses',
    },
  },
}
