import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarApiListResponse,
  type GoogleCalendarListParams,
  type GoogleCalendarListResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export const listTool: ToolConfig<GoogleCalendarListParams, GoogleCalendarListResponse> = {
  id: 'google_calendar_list',
  name: 'Google Calendar List Events',
  description: 'List events from Google Calendar',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-calendar',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Google Calendar API',
    },
    calendarId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Calendar ID (e.g., primary or calendar@group.calendar.google.com)',
    },
    timeMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lower bound for events (RFC3339 timestamp, e.g., 2025-06-03T00:00:00Z)',
    },
    timeMax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Upper bound for events (RFC3339 timestamp, e.g., 2025-06-04T00:00:00Z)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Order of events returned (startTime or updated)',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Include deleted events',
    },
  },

  request: {
    url: (params: GoogleCalendarListParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.timeMin) queryParams.append('timeMin', params.timeMin)
      if (params.timeMax) queryParams.append('timeMax', params.timeMax)
      queryParams.append('singleEvents', 'true')
      if (params.orderBy) queryParams.append('orderBy', params.orderBy)
      if (params.showDeleted !== undefined)
        queryParams.append('showDeleted', params.showDeleted.toString())

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarListParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiListResponse = await response.json()
    const events = data.items || []
    const eventsCount = events.length

    return {
      success: true,
      output: {
        content: `Found ${eventsCount} event${eventsCount !== 1 ? 's' : ''}`,
        metadata: {
          nextPageToken: data.nextPageToken,
          nextSyncToken: data.nextSyncToken,
          timeZone: data.timeZone,
          events: events.map((event: GoogleCalendarApiEventResponse) => ({
            id: event.id,
            htmlLink: event.htmlLink,
            status: event.status,
            summary: event.summary || 'No title',
            description: event.description,
            location: event.location,
            start: event.start,
            end: event.end,
            attendees: event.attendees,
            creator: event.creator,
            organizer: event.organizer,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of found events count' },
    metadata: {
      type: 'json',
      description: 'List of events with pagination tokens and event details',
    },
  },
}

interface GoogleCalendarListV2Response {
  success: boolean
  output: {
    nextPageToken: string | null
    timeZone: string | null
    events: Array<Record<string, any>>
  }
}

export const listV2Tool: ToolConfig<GoogleCalendarListParams, GoogleCalendarListV2Response> = {
  id: 'google_calendar_list_v2',
  name: 'Google Calendar List Events',
  description: 'List events from Google Calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: listTool.oauth,
  params: listTool.params,
  request: listTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiListResponse = await response.json()
    const events = data.items || []

    return {
      success: true,
      output: {
        nextPageToken: data.nextPageToken ?? null,
        timeZone: data.timeZone ?? null,
        events: events.map((event: GoogleCalendarApiEventResponse) => ({
          id: event.id,
          htmlLink: event.htmlLink,
          status: event.status,
          summary: event.summary ?? null,
          description: event.description ?? null,
          location: event.location ?? null,
          start: event.start,
          end: event.end,
          attendees: event.attendees ?? null,
          creator: event.creator,
          organizer: event.organizer,
        })),
      },
    }
  },
  outputs: {
    nextPageToken: { type: 'string', description: 'Next page token', optional: true },
    timeZone: { type: 'string', description: 'Calendar time zone', optional: true },
    events: { type: 'json', description: 'List of events' },
  },
}
