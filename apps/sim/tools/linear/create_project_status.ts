import type {
  LinearCreateProjectStatusParams,
  LinearCreateProjectStatusResponse,
} from '@/tools/linear/types'
import { PROJECT_STATUS_OUTPUT_PROPERTIES } from '@/tools/linear/types'
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
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Status type: "backlog", "planned", "started", "paused", "completed", or "canceled"',
    },
    color: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Status color (hex code)',
    },
    position: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Position in status list (e.g. 0, 1, 2...)',
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
        type: params.type,
        color: params.color,
        position: params.position,
      }

      if (params.description != null && params.description !== '') {
        input.description = params.description
      }
      if (params.indefinite != null) {
        input.indefinite = params.indefinite
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
                type
                createdAt
                updatedAt
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
    if (!result.success) {
      return {
        success: false,
        error: 'Project status creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        projectStatus: result.status,
      },
    }
  },

  outputs: {
    projectStatus: {
      type: 'object',
      description: 'The created project status',
      properties: PROJECT_STATUS_OUTPUT_PROPERTIES,
    },
  },
}
