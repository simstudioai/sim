import type {
  LinearCreateProjectLabelParams,
  LinearCreateProjectLabelResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateProjectLabelTool: ToolConfig<
  LinearCreateProjectLabelParams,
  LinearCreateProjectLabelResponse
> = {
  id: 'linear_create_project_label',
  name: 'Linear Create Project Label',
  description: 'Create a new project label in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project label name',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label color (hex code)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label description',
    },
    isGroup: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this is a label group',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent label group ID',
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
        name: params.name,
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
      if (params.isGroup !== undefined && params.isGroup !== null) {
        input.isGroup = params.isGroup
      }
      if (params.parentId !== undefined && params.parentId !== null && params.parentId !== '') {
        input.parentId = params.parentId
      }

      return {
        query: `
          mutation ProjectLabelCreate($input: ProjectLabelCreateInput!) {
            projectLabelCreate(input: $input) {
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
        error: data.errors[0]?.message || 'Failed to create project label',
        output: {},
      }
    }

    const result = data.data.projectLabelCreate
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
      description: 'The created project label',
    },
  },
}
