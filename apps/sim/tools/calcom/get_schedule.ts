import type { CalcomGetScheduleParams, CalcomGetScheduleResponse } from '@/tools/calcom/types'
import { SCHEDULE_DATA_OUTPUT_PROPERTIES } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const getScheduleTool: ToolConfig<CalcomGetScheduleParams, CalcomGetScheduleResponse> = {
  id: 'calcom_get_schedule',
  name: 'Cal.com Get Schedule',
  description: 'Get a specific schedule by ID from Cal.com',
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
      description: 'ID of the schedule to retrieve',
    },
  },

  request: {
    url: (params: CalcomGetScheduleParams) =>
      `https://api.cal.com/v2/schedules/${encodeURIComponent(params.scheduleId)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-11',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Response status',
    },
    data: {
      type: 'object',
      description: 'Schedule data',
      properties: SCHEDULE_DATA_OUTPUT_PROPERTIES,
    },
  },
}
