import type { CalcomListSchedulesParams, CalcomListSchedulesResponse } from '@/tools/calcom/types'
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
          properties: {
            id: {
              type: 'number',
              description: 'Unique identifier for the schedule',
            },
            name: {
              type: 'string',
              description: 'Name of the schedule',
            },
            timeZone: {
              type: 'string',
              description: 'Timezone of the schedule',
            },
            isDefault: {
              type: 'boolean',
              description: 'Whether this is the default schedule',
            },
            availability: {
              type: 'array',
              description: 'Availability intervals',
              items: {
                type: 'object',
                properties: {
                  days: {
                    type: 'array',
                    description: 'Days of the week',
                  },
                  startTime: {
                    type: 'string',
                    description: 'Start time in HH:MM format',
                  },
                  endTime: {
                    type: 'string',
                    description: 'End time in HH:MM format',
                  },
                },
              },
            },
          },
        },
      },
    },
  }
