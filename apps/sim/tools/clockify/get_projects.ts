import type { ClockifyGetProjectsParams, ClockifyGetProjectsResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetProjectsTool: ToolConfig<
  ClockifyGetProjectsParams,
  ClockifyGetProjectsResponse
> = {
  id: 'clockify_get_projects',
  name: 'Clockify Get Projects',
  description: 'Get all projects in a Clockify workspace',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Clockify API key',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace ID to get projects from',
    },
  },

  request: {
    url: (params) => `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/projects`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get projects')
    }

    return {
      success: true,
      output: {
        projects: data,
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'Array of project objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Project name' },
          clientId: { type: 'string', description: 'Client ID associated with the project' },
          color: { type: 'string', description: 'Project color' },
          archived: { type: 'boolean', description: 'Whether the project is archived' },
          billable: { type: 'boolean', description: 'Whether the project is billable' },
        },
      },
    },
  },
}
