import type {
  LinearAddLabelToProjectParams,
  LinearAddLabelToProjectResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearAddLabelToProjectTool: ToolConfig<
  LinearAddLabelToProjectParams,
  LinearAddLabelToProjectResponse
> = {
  id: 'linear_add_label_to_project',
  name: 'Linear Add Label to Project',
  description: 'Add a label to a project in Linear',
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
      description: 'Label ID to add',
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
        mutation ProjectAddLabel($id: String!, $labelId: String!) {
          projectAddLabel(id: $id, labelId: $labelId) {
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
        error: data.errors[0]?.message || 'Failed to add label to project',
        output: {},
      }
    }

    const result = data.data.projectAddLabel
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
      description: 'Whether the label was added successfully',
    },
    projectId: {
      type: 'string',
      description: 'The project ID',
    },
  },
}
