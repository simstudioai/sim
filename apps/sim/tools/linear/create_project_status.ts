import type {
  LinearCreateProjectStatusParams,
  LinearCreateProjectStatusResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateProjectStatusTool: ToolConfig<
  LinearCreateProjectStatusParams,
  LinearCreateProjectStatusResponse
> = {
  id: 'linear_create_project_status',
  name: 'Linear Create Project Status',
  description: 'Create a new project status in Linear',
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
      description: 'Project status name',
    },
    color: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Status color (hex code)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status description',
    },
    indefinite: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the status is indefinite',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position in status list',
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
        color: params.color,
      }

      if (
        params.description !== undefined &&
        params.description !== null &&
        params.description !== ''
      ) {
        input.description = params.description
      }
      if (params.indefinite !== undefined && params.indefinite !== null) {
        input.indefinite = params.indefinite
      }
      if (params.position !== undefined && params.position !== null) {
        input.position = params.position
      }

      return {
        query: `
          mutation ProjectStatusCreate($input: ProjectStatusCreateInput!) {
            projectStatusCreate(input: $input) {
              success
              status {
                id
                name
                description
                color
                indefinite
                position
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
        error: data.errors[0]?.message || 'Failed to create project status',
        output: {},
      }
    }

    const result = data.data.projectStatusCreate
    return {
      success: result.success,
      output: {
        projectStatus: result.status,
      },
    }
  },

  outputs: {
    projectStatus: {
      type: 'object',
      description: 'The created project status',
    },
  },
}
