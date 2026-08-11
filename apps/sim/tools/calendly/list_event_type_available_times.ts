import type {
  CalendlyListEventTypeAvailableTimesParams,
  CalendlyListEventTypeAvailableTimesResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const listEventTypeAvailableTimesTool: ToolConfig<
  CalendlyListEventTypeAvailableTimesParams,
  CalendlyListEventTypeAvailableTimesResponse
> = {
  id: 'calendly_list_event_type_available_times',
  name: 'Calendly List Event Type Available Times',
  description: 'Retrieve bookable time slots for an event type within a date range',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    eventTypeUri: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Event type to check. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/event_types/abc123-def456")',
    },
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start of the availability range. Cannot be in the past. Format: ISO 8601 (e.g., "2024-01-01T00:00:00Z")',
    },
    endTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End of the availability range. Must be in the future and no more than 31 days after the start. Format: ISO 8601 (e.g., "2024-01-15T00:00:00Z")',
    },
  },

  request: {
    url: (params: CalendlyListEventTypeAvailableTimesParams) => {
      const queryParams = [
        `event_type=${encodeURIComponent(toResourceUri(params.eventTypeUri, 'event_types'))}`,
        `start_time=${encodeURIComponent(params.startTime)}`,
        `end_time=${encodeURIComponent(params.endTime)}`,
      ]

      return `https://api.calendly.com/event_type_available_times?${queryParams.join('&')}`
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
      description: 'Array of available time slots',
      items: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Availability status of the slot' },
          invitees_remaining: {
            type: 'number',
            description: 'Number of invitees that can still book this slot',
          },
          start_time: { type: 'string', description: 'ISO timestamp of the slot start' },
          scheduling_url: { type: 'string', description: 'URL that books this exact slot' },
        },
      },
    },
  },
}
