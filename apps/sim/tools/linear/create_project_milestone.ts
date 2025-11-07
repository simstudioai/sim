import type {
  LinearCreateProjectMilestoneParams,
  LinearCreateProjectMilestoneResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateProjectMilestoneTool: ToolConfig<
  LinearCreateProjectMilestoneParams,
  LinearCreateProjectMilestoneResponse
> = {
  id: 'linear_create_project_milestone',
  name: 'Linear Create Project Milestone',
  description: 'Create a new project milestone in Linear',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Milestone name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Milestone description',
    },
    targetDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target date (ISO 8601)',
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
    body: (params) => {
      const input: Record<string, any> = {
        projectId: params.projectId,
        name: params.name,
      }

      if (
        params.description !== undefined &&
        params.description !== null &&
        params.description !== ''
      ) {
        input.description = params.description
      }
      if (
        params.targetDate !== undefined &&
        params.targetDate !== null &&
        params.targetDate !== ''
      ) {
        input.targetDate = params.targetDate
      }

      return {
        query: `
          mutation ProjectMilestoneCreate($input: ProjectMilestoneCreateInput!) {
            projectMilestoneCreate(input: $input) {
              success
              projectMilestone {
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
        `,
        variables: {
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create project milestone',
        output: {},
      }
    }

    const result = data.data.projectMilestoneCreate
    return {
      success: result.success,
      output: {
        projectMilestone: result.projectMilestone,
      },
    }
  },

  outputs: {
    projectMilestone: {
      type: 'object',
      description: 'The created project milestone',
    },
  },
}
