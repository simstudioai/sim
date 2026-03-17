import type { ClockifyGetTimeEntriesParams, ClockifyGetTimeEntriesResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetTimeEntriesTool: ToolConfig<
  ClockifyGetTimeEntriesParams,
  ClockifyGetTimeEntriesResponse
> = {
  id: 'clockify_get_time_entries',
  name: 'Clockify Get Time Entries',
  description: 'Get time entries for a user in a Clockify workspace with optional date filtering',
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
      description: 'Workspace ID to get time entries from',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to get time entries for',
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
    url: (params) => {
      const base = `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/user/${params.userId}/time-entries`
      const query: string[] = []
      if (params.start) query.push(`start=${encodeURIComponent(params.start)}`)
      if (params.end) query.push(`end=${encodeURIComponent(params.end)}`)
      return query.length > 0 ? `${base}?${query.join('&')}` : base
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get time entries')
    }

    return {
      success: true,
      output: {
        timeEntries: data,
      },
    }
  },

  outputs: {
    timeEntries: {
      type: 'array',
      description: 'Array of time entry objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Time entry ID' },
          description: { type: 'string', description: 'Time entry description' },
          timeInterval: { type: 'object', description: 'Start, end, and duration of the entry' },
          projectId: { type: 'string', description: 'Associated project ID' },
          billable: { type: 'boolean', description: 'Whether the entry is billable' },
          userId: { type: 'string', description: 'User ID who created the entry' },
        },
      },
    },
  },
}
