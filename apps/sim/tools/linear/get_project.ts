import type { LinearGetProjectParams, LinearGetProjectResponse } from '@/tools/linear/types'
import { PROJECT_FULL_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearGetProjectTool: ToolConfig<LinearGetProjectParams, LinearGetProjectResponse> = {
  id: 'linear_get_project',
  name: 'Linear Get Project',
  description: 'Get a single project by ID from Linear',
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
      description: 'Linear project ID',
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
        query GetProject($id: String!) {
          project(id: $id) {
            id
            name
            description
            state
            priority
            startDate
            targetDate
            completedAt
            canceledAt
            archivedAt
            url
            lead {
              id
              name
            }
            teams {
              nodes {
                id
                name
              }
            }
          }
        }
      `,
      variables: {
        id: params.projectId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch project',
        output: {},
      }
    }

    const project = data.data.project
    return {
      success: true,
      output: {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          state: project.state,
          priority: project.priority,
          startDate: project.startDate,
          targetDate: project.targetDate,
          completedAt: project.completedAt,
          canceledAt: project.canceledAt,
          archivedAt: project.archivedAt,
          url: project.url,
          lead: project.lead,
          teams: project.teams?.nodes || [],
        },
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The project with full details',
      properties: PROJECT_FULL_OUTPUT_PROPERTIES,
    },
  },
}
