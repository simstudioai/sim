import type { CalcomDeleteScheduleParams, CalcomDeleteScheduleResponse } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const deleteScheduleTool: ToolConfig<
  CalcomDeleteScheduleParams,
  CalcomDeleteScheduleResponse
> = {
  id: 'calcom_delete_schedule',
  name: 'Cal.com Delete Schedule',
  description: 'Delete a schedule from Cal.com',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'calcom',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Cal.com OAuth access token',
    },
    scheduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the schedule to delete',
    },
  },

  request: {
    url: (params: CalcomDeleteScheduleParams) =>
      `https://api.cal.com/v2/schedules/${encodeURIComponent(params.scheduleId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-11',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: data,
        error:
          data.error?.message || data.message || `Request failed with status ${response.status}`,
      }
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Response status (success or error)',
    },
  },
}
