import type {
  LinearDeleteProjectMilestoneParams,
  LinearDeleteProjectMilestoneResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteProjectMilestoneTool: ToolConfig<
  LinearDeleteProjectMilestoneParams,
  LinearDeleteProjectMilestoneResponse
> = {
  id: 'linear_delete_project_milestone',
  name: 'Linear Delete Project Milestone',
  description: 'Delete a project milestone in Linear',
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
      description: 'Project milestone ID to delete',
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
        mutation ProjectMilestoneDelete($id: String!) {
          projectMilestoneDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.milestoneId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete project milestone',
        output: {},
      }
    }

    const result = data.data.projectMilestoneDelete
    return {
      success: result.success,
      output: {
        success: result.success,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the deletion was successful',
    },
  },
}
