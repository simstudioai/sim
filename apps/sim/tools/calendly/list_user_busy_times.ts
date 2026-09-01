import type {
  CalendlyListUserBusyTimesParams,
  CalendlyListUserBusyTimesResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const listUserBusyTimesTool: ToolConfig<
  CalendlyListUserBusyTimesParams,
  CalendlyListUserBusyTimesResponse
> = {
  id: 'calendly_list_user_busy_times',
  name: 'Calendly List User Busy Times',
  description:
    "Retrieve a user's internal and external busy times within a date range, based on their connected calendars",
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
        'User whose busy times are returned. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/users/abc123-def456")',
    },
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start of the requested range. Cannot be in the past. Format: ISO 8601 (e.g., "2024-01-01T00:00:00Z")',
    },
    endTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End of the requested range. Must be after the start and no more than 7 days later. Format: ISO 8601 (e.g., "2024-01-07T00:00:00Z")',
    },
  },

  request: {
    url: (params: CalendlyListUserBusyTimesParams) => {
      const queryParams = [
        `user=${encodeURIComponent(toResourceUri(params.user, 'users'))}`,
        `start_time=${encodeURIComponent(params.startTime)}`,
        `end_time=${encodeURIComponent(params.endTime)}`,
      ]

      return `https://api.calendly.com/user_busy_times?${queryParams.join('&')}`
    },
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
      description: 'Array of busy time blocks',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Source of the busy block (calendly, external, or reserved)',
          },
          start_time: { type: 'string', description: 'ISO timestamp when the block starts' },
          end_time: { type: 'string', description: 'ISO timestamp when the block ends' },
          buffered_start_time: {
            type: 'string',
            description: 'ISO timestamp when the block starts including buffer',
            optional: true,
          },
          buffered_end_time: {
            type: 'string',
            description: 'ISO timestamp when the block ends including buffer',
            optional: true,
          },
          event: {
            type: 'object',
            description: 'The Calendly event occupying this block',
            optional: true,
            properties: {
              uri: { type: 'string', description: 'URI of the scheduled event' },
            },
          },
        },
      },
    },
  },
}
