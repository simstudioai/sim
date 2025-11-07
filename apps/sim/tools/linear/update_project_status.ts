import type {
  LinearUpdateProjectStatusParams,
  LinearUpdateProjectStatusResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateProjectStatusTool: ToolConfig<
  LinearUpdateProjectStatusParams,
  LinearUpdateProjectStatusResponse
> = {
  id: 'linear_update_project_status',
  name: 'Linear Update Project Status',
  description: 'Update a project status in Linear',
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
      description: 'Project status ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated status name',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated status color',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    indefinite: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated indefinite flag',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated position',
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
      if (params.indefinite !== undefined && params.indefinite !== null) {
        input.indefinite = params.indefinite
      }
      if (params.position !== undefined && params.position !== null) {
        input.position = params.position
      }

      return {
        query: `
          mutation ProjectStatusUpdate($id: String!, $input: ProjectStatusUpdateInput!) {
            projectStatusUpdate(id: $id, input: $input) {
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
          id: params.statusId,
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
        error: data.errors[0]?.message || 'Failed to update project status',
        output: {},
      }
    }

    const result = data.data.projectStatusUpdate
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
      description: 'The updated project status',
    },
  },
}
