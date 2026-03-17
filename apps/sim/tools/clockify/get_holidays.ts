import type { ClockifyGetHolidaysParams, ClockifyGetHolidaysResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetHolidaysTool: ToolConfig<
  ClockifyGetHolidaysParams,
  ClockifyGetHolidaysResponse
> = {
  id: 'clockify_get_holidays',
  name: 'Clockify Holidays',
  description: 'Get holidays configured in a Clockify workspace',
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
      description: 'Workspace ID to get holidays from',
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
      description: 'Filter end date in ISO8601 format (e.g., "2024-12-31T23:59:59Z")',
    },
  },

  request: {
    url: (params) => {
      const base = `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/holidays`
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
      throw new Error(data.message || data.error || 'Failed to get holidays')
    }

    return {
      success: true,
      output: {
        holidays: data,
      },
    }
  },

  outputs: {
    holidays: {
      type: 'json',
      description: 'Array of holiday objects',
    },
  },
}
