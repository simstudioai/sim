import type {
  CalendlyListUserAvailabilitySchedulesParams,
  CalendlyListUserAvailabilitySchedulesResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const listUserAvailabilitySchedulesTool: ToolConfig<
  CalendlyListUserAvailabilitySchedulesParams,
  CalendlyListUserAvailabilitySchedulesResponse
> = {
  id: 'calendly_list_user_availability_schedules',
  name: 'Calendly List User Availability Schedules',
  description: "Retrieve a user's availability schedules, working hours, and date overrides",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    user: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User whose schedules are returned. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/users/abc123-def456")',
    },
  },

  request: {
    url: (params: CalendlyListUserAvailabilitySchedulesParams) =>
      `https://api.calendly.com/user_availability_schedules?user=${encodeURIComponent(toResourceUri(params.user, 'users'))}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
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
    collection: {
      type: 'array',
      description: 'Array of availability schedules',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the schedule' },
          name: { type: 'string', description: 'Schedule name' },
          default: { type: 'boolean', description: "Whether this is the user's default schedule" },
          user: { type: 'string', description: 'URI of the owning user' },
          timezone: { type: 'string', description: 'Timezone the schedule is defined in' },
          rules: {
            type: 'array',
            description: 'Weekly rules and date overrides that make up the schedule',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Rule type (wday or date)' },
                wday: {
                  type: 'string',
                  description: 'Day of week the rule applies to, for wday rules',
                },
                date: {
                  type: 'string',
                  description: 'Calendar date the rule overrides, for date rules',
                },
                intervals: {
                  type: 'array',
                  description: 'Available intervals for the rule; empty means unavailable',
                  items: {
                    type: 'object',
                    properties: {
                      from: { type: 'string', description: 'Interval start time (HH:MM)' },
                      to: { type: 'string', description: 'Interval end time (HH:MM)' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
