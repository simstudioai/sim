import type { LinearDeleteProjectParams, LinearDeleteProjectResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteProjectTool: ToolConfig<
  LinearDeleteProjectParams,
  LinearDeleteProjectResponse
> = {
  id: 'linear_delete_project',
  name: 'Linear Delete Project',
  description: 'Delete a project in Linear',
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
      description: 'Project ID to delete',
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
        mutation ProjectDelete($id: String!) {
          projectDelete(id: $id) {
            success
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
        error: data.errors[0]?.message || 'Failed to delete project',
        output: {},
      }
    }

    const result = data.data.projectDelete
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
