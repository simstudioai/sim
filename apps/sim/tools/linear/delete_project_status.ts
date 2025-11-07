import type {
  LinearDeleteProjectStatusParams,
  LinearDeleteProjectStatusResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteProjectStatusTool: ToolConfig<
  LinearDeleteProjectStatusParams,
  LinearDeleteProjectStatusResponse
> = {
  id: 'linear_delete_project_status',
  name: 'Linear Delete Project Status',
  description: 'Delete a project status in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    statusId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project status ID to delete',
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
        mutation ProjectStatusDelete($id: String!) {
          projectStatusDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.statusId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete project status',
        output: {},
      }
    }

    const result = data.data.projectStatusDelete
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
