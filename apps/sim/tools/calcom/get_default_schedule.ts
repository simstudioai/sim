import type {
  CalcomGetDefaultScheduleParams,
  CalcomGetDefaultScheduleResponse,
} from '@/tools/calcom/types'
import { SCHEDULE_DATA_OUTPUT_PROPERTIES } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const getDefaultScheduleTool: ToolConfig<
  CalcomGetDefaultScheduleParams,
  CalcomGetDefaultScheduleResponse
> = {
  id: 'calcom_get_default_schedule',
  name: 'Cal.com Get Default Schedule',
  description: 'Get the default availability schedule from Cal.com',
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
  },

  request: {
    url: () => 'https://api.cal.com/v2/schedules/default',
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
      description: 'Default schedule data',
      properties: SCHEDULE_DATA_OUTPUT_PROPERTIES,
    },
  },
}
