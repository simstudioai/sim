import type { ClockifyGetTimeOffParams, ClockifyGetTimeOffResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetTimeOffTool: ToolConfig<
  ClockifyGetTimeOffParams,
  ClockifyGetTimeOffResponse
> = {
  id: 'clockify_get_time_off',
  name: 'Clockify Time Off Requests',
  description: 'Get time-off requests for a Clockify workspace with optional date filtering',
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
      description: 'Workspace ID to get time-off requests from',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter start date in ISO8601 format (e.g., "2024-01-01T00:00:00Z")',
    },
    end: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter end date in ISO8601 format (e.g., "2024-01-31T23:59:59Z")',
    },
  },

  request: {
    url: (params) =>
      `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/time-off/requests`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-Api-Key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.start) body.start = params.start
      if (params.end) body.end = params.end
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get time-off requests')
    }

    return {
      success: true,
      output: {
        requests: data,
      },
    }
  },

  outputs: {
    requests: {
      type: 'json',
      description: 'Array of time-off request objects',
    },
  },
}
