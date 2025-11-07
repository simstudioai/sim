import type {
  LinearListProjectMilestonesParams,
  LinearListProjectMilestonesResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListProjectMilestonesTool: ToolConfig<
  LinearListProjectMilestonesParams,
  LinearListProjectMilestonesResponse
> = {
  id: 'linear_list_project_milestones',
  name: 'Linear List Project Milestones',
  description: 'List all milestones for a project in Linear',
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
      description: 'Project ID to list milestones for',
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
        query Project($id: String!) {
          project(id: $id) {
            projectMilestones {
              nodes {
                id
                name
                description
                projectId
                targetDate
                createdAt
                archivedAt
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
        error: data.errors[0]?.message || 'Failed to list project milestones',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        projectMilestones: data.data.project?.projectMilestones?.nodes || [],
      },
    }
  },

  outputs: {
    projectMilestones: {
      type: 'array',
      description: 'List of project milestones',
    },
  },
}
