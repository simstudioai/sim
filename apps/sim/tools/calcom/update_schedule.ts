import type {
  CalcomAvailability,
  CalcomUpdateScheduleParams,
  CalcomUpdateScheduleResponse,
} from '@/tools/calcom/types'
import { SCHEDULE_DATA_OUTPUT_PROPERTIES } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const updateScheduleTool: ToolConfig<
  CalcomUpdateScheduleParams,
  CalcomUpdateScheduleResponse
> = {
  id: 'calcom_update_schedule',
  name: 'Cal.com Update Schedule',
  description: 'Update an existing schedule in Cal.com',
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
      description: 'ID of the schedule to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the schedule',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New timezone for the schedule (e.g., America/New_York)',
    },
    isDefault: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this schedule should be the default',
    },
    availability: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New availability intervals for the schedule',
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
    url: (params: CalcomUpdateScheduleParams) =>
      `https://api.cal.com/v2/schedules/${encodeURIComponent(params.scheduleId)}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-11',
    }),
    body: (params: CalcomUpdateScheduleParams) => {
      const body: {
        name?: string
        timeZone?: string
        isDefault?: boolean
        availability?: CalcomAvailability[]
      } = {}

      if (params.name !== undefined) {
        body.name = params.name
      }

      if (params.timeZone !== undefined) {
        body.timeZone = params.timeZone
      }

      if (params.isDefault !== undefined) {
        body.isDefault = params.isDefault
      }

      if (params.availability !== undefined) {
        body.availability = params.availability
      }

      return body
    },
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
      description: 'Updated schedule data',
      properties: SCHEDULE_DATA_OUTPUT_PROPERTIES,
    },
  },
}
