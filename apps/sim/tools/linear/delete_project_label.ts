import type {
  LinearDeleteProjectLabelParams,
  LinearDeleteProjectLabelResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteProjectLabelTool: ToolConfig<
  LinearDeleteProjectLabelParams,
  LinearDeleteProjectLabelResponse
> = {
  id: 'linear_delete_project_label',
  name: 'Linear Delete Project Label',
  description: 'Delete a project label in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project label ID to delete',
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
        mutation ProjectLabelDelete($id: String!) {
          projectLabelDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.labelId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete project label',
        output: {},
      }
    }

    const result = data.data.projectLabelDelete
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
