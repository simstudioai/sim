import type {
  CalcomAvailability,
  CalcomCreateScheduleParams,
  CalcomCreateScheduleResponse,
} from '@/tools/calcom/types'
import { SCHEDULE_DATA_OUTPUT_PROPERTIES } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const createScheduleTool: ToolConfig<
  CalcomCreateScheduleParams,
  CalcomCreateScheduleResponse
> = {
  id: 'calcom_create_schedule',
  name: 'Cal.com Create Schedule',
  description: 'Create a new availability schedule in Cal.com',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the schedule',
    },
    timeZone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timezone for the schedule (e.g., America/New_York)',
    },
    isDefault: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether this schedule should be the default',
    },
    availability: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Availability intervals for the schedule',
      items: {
        type: 'object',
        description: 'Availability interval',
        properties: {
          days: {
            type: 'array',
            description:
              'Days of the week (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday)',
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

  request: {
    url: () => 'https://api.cal.com/v2/schedules',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-11',
    }),
    body: (params: CalcomCreateScheduleParams) => {
      const body: {
        name: string
        timeZone: string
        isDefault: boolean
        availability?: CalcomAvailability[]
      } = {
        name: params.name,
        timeZone: params.timeZone,
        isDefault: params.isDefault,
      }

      if (params.availability) {
        body.availability = params.availability
      }

      return body
    },
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
      description: 'Response status',
    },
    data: {
      type: 'object',
      description: 'Created schedule data',
      properties: SCHEDULE_DATA_OUTPUT_PROPERTIES,
    },
  },
}
