import {
  CALENDAR_EVENT_OUTPUT_PROPERTIES,
  type CirclebackCalendarEventListResponse,
  type CirclebackListCalendarEventsParams,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  parseNextCursor,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const listCalendarEventsTool: ToolConfig<
  CirclebackListCalendarEventsParams,
  CirclebackCalendarEventListResponse
> = {
  id: 'circleback_list_calendar_events',
  name: 'Circleback List Calendar Events',
  description:
    'Lists upcoming calendar events from the authenticated user connected calendars, with pagination and a configurable time window.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    startTimeLookbackHours: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How many hours in the past to include calendar meetings from',
    },
    startTimeLookaheadHours: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How many hours in the future to include calendar meetings from',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The direction calendar meetings are sorted in by start time: ascending or descending. Defaults to ascending',
    },
    includeOfflineSingleAttendee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to true to include calendar meetings that have no meeting link and only one attendee',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${CIRCLEBACK_API_BASE}/calendar/events`)
      if (params.startTimeLookbackHours) {
        url.searchParams.append('startTimeLookbackHours', String(params.startTimeLookbackHours))
      }
      if (params.startTimeLookaheadHours) {
        url.searchParams.append('startTimeLookaheadHours', String(params.startTimeLookaheadHours))
      }
      if (params.sortDirection) url.searchParams.append('sortDirection', params.sortDirection)
      if (String(params.includeOfflineSingleAttendee) === 'true') {
        url.searchParams.append('includeOfflineSingleAttendee', 'true')
      }
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()
    const nextCursor = parseNextCursor(response)

    return {
      success: true,
      output: {
        events: Array.isArray(data) ? data : [],
        nextCursor,
        hasMore: nextCursor !== null,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'The calendar events on this page',
      items: { type: 'object', properties: CALENDAR_EVENT_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page of calendar events is available',
    },
  },
}
