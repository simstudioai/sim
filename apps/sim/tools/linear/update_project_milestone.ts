import type {
  LinearUpdateProjectMilestoneParams,
  LinearUpdateProjectMilestoneResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateProjectMilestoneTool: ToolConfig<
  LinearUpdateProjectMilestoneParams,
  LinearUpdateProjectMilestoneResponse
> = {
  id: 'linear_update_project_milestone',
  name: 'Linear Update Project Milestone',
  description: 'Update a project milestone in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    milestoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project milestone ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated milestone name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    targetDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated target date (ISO 8601)',
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
      const input: Record<string, any> = {}

      if (params.name !== undefined && params.name !== null && params.name !== '') {
        input.name = params.name
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
          mutation ProjectMilestoneUpdate($id: String!, $input: ProjectMilestoneUpdateInput!) {
            projectMilestoneUpdate(id: $id, input: $input) {
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
          id: params.milestoneId,
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
        error: data.errors[0]?.message || 'Failed to update project milestone',
        output: {},
      }
    }

    const result = data.data.projectMilestoneUpdate
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
      description: 'The updated project milestone',
    },
  },
}
