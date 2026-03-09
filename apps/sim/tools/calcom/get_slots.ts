import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface CalcomGetSlotsParams {
  accessToken: string
  start: string
  end: string
  eventTypeId?: number
  eventTypeSlug?: string
  username?: string
  timeZone?: string
  duration?: number
}

export interface CalcomGetSlotsResponse extends ToolResponse {
  output: {
    status: string
    /** Slots grouped by date (YYYY-MM-DD format) */
    data: Record<
      string,
      Array<{
        /** ISO 8601 timestamp of slot start time */
        start: string
        /** ISO 8601 timestamp of slot end time (only when format=range) */
        end?: string
        /** Number of attendees already booked (for seated events) */
        attendeesCount?: number
        /** Booking UID (for seated events) */
        bookingUid?: string
      }>
    >
  }
}

export const getSlotsTool: ToolConfig<CalcomGetSlotsParams, CalcomGetSlotsResponse> = {
  id: 'calcom_get_slots',
  name: 'Cal.com Get Slots',
  description: 'Get available booking slots for a Cal.com event type within a time range',
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
    start: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of time range in UTC ISO 8601 format (e.g., 2024-01-15T00:00:00Z)',
    },
    end: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of time range in UTC ISO 8601 format (e.g., 2024-01-22T00:00:00Z)',
    },
    eventTypeId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event type ID for direct lookup',
    },
    eventTypeSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event type slug (requires username to be set)',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Username for personal event types (required when using eventTypeSlug)',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timezone for returned slots (defaults to UTC)',
    },
    duration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slot length in minutes',
    },
  },

  request: {
    url: (params: CalcomGetSlotsParams) => {
      const baseUrl = 'https://api.cal.com/v2/slots'
      const queryParams: string[] = []

      queryParams.push(`start=${encodeURIComponent(params.start)}`)
      queryParams.push(`end=${encodeURIComponent(params.end)}`)

      if (
        params.eventTypeId !== undefined &&
        params.eventTypeId !== null &&
        !Number.isNaN(params.eventTypeId) &&
        String(params.eventTypeId) !== ''
      ) {
        queryParams.push(`eventTypeId=${params.eventTypeId}`)
      }

      if (params.eventTypeSlug) {
        queryParams.push(`eventTypeSlug=${encodeURIComponent(params.eventTypeSlug)}`)
      }

      if (params.username) {
        queryParams.push(`username=${encodeURIComponent(params.username)}`)
      }

      if (params.timeZone) {
        queryParams.push(`timeZone=${encodeURIComponent(params.timeZone)}`)
      }

      if (
        params.duration !== undefined &&
        params.duration !== null &&
        !Number.isNaN(params.duration) &&
        String(params.duration) !== ''
      ) {
        queryParams.push(`duration=${params.duration}`)
      }

      return `${baseUrl}?${queryParams.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-09-04',
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
      description: 'Response status',
    },
    data: {
      type: 'json',
      description:
        'Available time slots grouped by date (YYYY-MM-DD keys). Each date maps to an array of slot objects with start time, optional end time, and seated event info.',
    },
  },
}
