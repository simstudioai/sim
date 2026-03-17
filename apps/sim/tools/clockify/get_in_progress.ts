import type { ClockifyGetInProgressParams, ClockifyGetInProgressResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetInProgressTool: ToolConfig<
  ClockifyGetInProgressParams,
  ClockifyGetInProgressResponse
> = {
  id: 'clockify_get_in_progress',
  name: 'Clockify In-Progress Timers',
  description: 'Get currently running time entries in a Clockify workspace',
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
      description: 'Workspace ID to check for in-progress timers',
    },
  },

  request: {
    url: (params) =>
      `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/time-entries/in-progress`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get in-progress timers')
    }

    return {
      success: true,
      output: {
        timeEntries: Array.isArray(data) ? data : [data].filter(Boolean),
      },
    }
  },

  outputs: {
    timeEntries: {
      type: 'array',
      description: 'Array of in-progress time entry objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Time entry ID' },
          description: { type: 'string', description: 'Time entry description' },
          timeInterval: { type: 'object', description: 'Start time and duration of the entry' },
          projectId: { type: 'string', description: 'Associated project ID' },
          userId: { type: 'string', description: 'User ID who created the entry' },
        },
      },
    },
  },
}
