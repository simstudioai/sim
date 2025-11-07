import type {
  LinearRemoveLabelFromProjectParams,
  LinearRemoveLabelFromProjectResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearRemoveLabelFromProjectTool: ToolConfig<
  LinearRemoveLabelFromProjectParams,
  LinearRemoveLabelFromProjectResponse
> = {
  id: 'linear_remove_label_from_project',
  name: 'Linear Remove Label from Project',
  description: 'Remove a label from a project in Linear',
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
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label ID to remove',
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
        mutation ProjectRemoveLabel($id: String!, $labelId: String!) {
          projectRemoveLabel(id: $id, labelId: $labelId) {
            success
            project {
              id
            }
          }
        }
      `,
      variables: {
        id: params.projectId,
        labelId: params.labelId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to remove label from project',
        output: {},
      }
    }

    const result = data.data.projectRemoveLabel
    return {
      success: result.success,
      output: {
        success: result.success,
        projectId: result.project?.id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the label was removed successfully',
    },
    projectId: {
      type: 'string',
      description: 'The project ID',
    },
  },
}
