import type { CalcomListSchedulesParams, CalcomListSchedulesResponse } from '@/tools/calcom/types'
import { SCHEDULE_DATA_OUTPUT_PROPERTIES } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const listSchedulesTool: ToolConfig<CalcomListSchedulesParams, CalcomListSchedulesResponse> =
  {
    id: 'calcom_list_schedules',
    name: 'Cal.com List Schedules',
    description: 'List all availability schedules from Cal.com',
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
      url: () => 'https://api.cal.com/v2/schedules',
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
        type: 'array',
        description: 'Array of schedule objects',
        items: {
          type: 'object',
          properties: SCHEDULE_DATA_OUTPUT_PROPERTIES,
        },
      },
    },
  }
