import type { ClockifyGetTimeEntryParams, ClockifyGetTimeEntryResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetTimeEntryTool: ToolConfig<
  ClockifyGetTimeEntryParams,
  ClockifyGetTimeEntryResponse
> = {
  id: 'clockify_get_time_entry',
  name: 'Clockify Get Time Entry',
  description: 'Get details of a single time entry by ID',
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
      description: 'Workspace ID the time entry belongs to',
    },
    timeEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time entry ID to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/time-entries/${params.timeEntryId}`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get time entry')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Time entry ID',
    },
    description: {
      type: 'string',
      description: 'Time entry description',
    },
    timeInterval: {
      type: 'json',
      description: 'Start, end, and duration of the entry',
    },
    projectId: {
      type: 'string',
      description: 'Associated project ID',
    },
    billable: {
      type: 'boolean',
      description: 'Whether the entry is billable',
    },
    userId: {
      type: 'string',
      description: 'User ID who created the entry',
    },
  },
}
