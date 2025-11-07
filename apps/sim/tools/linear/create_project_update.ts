import type {
  LinearCreateProjectUpdateParams,
  LinearCreateProjectUpdateResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateProjectUpdateTool: ToolConfig<
  LinearCreateProjectUpdateParams,
  LinearCreateProjectUpdateResponse
> = {
  id: 'linear_create_project_update',
  name: 'Linear Create Project Update',
  description: 'Post a status update for a project in Linear',
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
      description: 'Project ID to post update for',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Update message (supports Markdown)',
    },
    health: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project health: "onTrack", "atRisk", or "offTrack"',
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
        projectId: params.projectId,
        body: params.body,
      }

      if (params.health !== undefined && params.health !== null && params.health !== '')
        input.health = params.health

      return {
        query: `
          mutation CreateProjectUpdate($input: ProjectUpdateCreateInput!) {
            projectUpdateCreate(input: $input) {
              success
              projectUpdate {
                id
                body
                health
                createdAt
                user {
                  id
                  name
                }
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
        error: data.errors[0]?.message || 'Failed to create project update',
        output: {},
      }
    }

    const result = data.data.projectUpdateCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Project update creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        update: result.projectUpdate,
      },
    }
  },

  outputs: {
    update: {
      type: 'object',
      description: 'The created project update',
      properties: {
        id: { type: 'string', description: 'Update ID' },
        body: { type: 'string', description: 'Update message' },
        health: { type: 'string', description: 'Project health status' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        user: { type: 'object', description: 'User who created the update' },
      },
    },
  },
}
