import type {
  LinearUpdateProjectLabelParams,
  LinearUpdateProjectLabelResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateProjectLabelTool: ToolConfig<
  LinearUpdateProjectLabelParams,
  LinearUpdateProjectLabelResponse
> = {
  id: 'linear_update_project_label',
  name: 'Linear Update Project Label',
  description: 'Update a project label in Linear',
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
      description: 'Project label ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated label name',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated label color',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
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
      if (params.color !== undefined && params.color !== null && params.color !== '') {
        input.color = params.color
      }
      if (
        params.description !== undefined &&
        params.description !== null &&
        params.description !== ''
      ) {
        input.description = params.description
      }

      return {
        query: `
          mutation ProjectLabelUpdate($id: String!, $input: ProjectLabelUpdateInput!) {
            projectLabelUpdate(id: $id, input: $input) {
              success
              projectLabel {
                id
                name
                description
                color
                isGroup
                createdAt
                archivedAt
              }
            }
          }
        `,
        variables: {
          id: params.labelId,
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
        error: data.errors[0]?.message || 'Failed to update project label',
        output: {},
      }
    }

    const result = data.data.projectLabelUpdate
    return {
      success: result.success,
      output: {
        projectLabel: result.projectLabel,
      },
    }
  },

  outputs: {
    projectLabel: {
      type: 'object',
      description: 'The updated project label',
    },
  },
}
