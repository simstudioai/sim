import type { ClockifyGetWorkspacesParams, ClockifyGetWorkspacesResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetWorkspacesTool: ToolConfig<
  ClockifyGetWorkspacesParams,
  ClockifyGetWorkspacesResponse
> = {
  id: 'clockify_get_workspaces',
  name: 'Clockify Get Workspaces',
  description: 'Get all workspaces the authenticated user belongs to',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Clockify API key',
    },
  },

  request: {
    url: 'https://api.clockify.me/api/v1/workspaces',
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get workspaces')
    }

    return {
      success: true,
      output: {
        workspaces: data,
      },
    }
  },

  outputs: {
    workspaces: {
      type: 'array',
      description: 'Array of workspace objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workspace ID' },
          name: { type: 'string', description: 'Workspace name' },
        },
      },
    },
  },
}
