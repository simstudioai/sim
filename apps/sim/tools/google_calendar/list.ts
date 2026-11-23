import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarApiListResponse,
  type GoogleCalendarEventDetails,
  type GoogleCalendarListParams,
  type GoogleCalendarListResponse,
} from '@/tools/google_calendar/types'
import { buildEventDetails, EVENT_DETAIL_OUTPUTS } from '@/tools/google_calendar/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-text search across event summary, description, location, attendees, and organizer',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return (max 2500)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Token for retrieving the next page of results',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Order of events: startTime (chronological, the default) or updated (last-modified). startTime is always valid here because singleEvents is set.',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Include deleted events',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "IANA time zone used for times in the response (e.g., America/New_York). Defaults to the calendar's time zone.",
    },
    updatedMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return events modified at or after this time (RFC3339 timestamp, e.g., 2025-06-03T00:00:00Z). Events deleted since then are always included.',
    },
  },

  request: {
    url: (params: GoogleCalendarListParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.timeMin) queryParams.append('timeMin', params.timeMin)
      if (params.timeMax) queryParams.append('timeMax', params.timeMax)
      if (params.q) queryParams.append('q', params.q)
      if (params.maxResults) queryParams.append('maxResults', params.maxResults.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)
      queryParams.append('singleEvents', 'true')
      queryParams.append('orderBy', params.orderBy || 'startTime')
      if (params.showDeleted !== undefined)
        queryParams.append('showDeleted', params.showDeleted.toString())
      if (params.timeZone) queryParams.append('timeZone', params.timeZone)
      if (params.updatedMin) queryParams.append('updatedMin', params.updatedMin)

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${safeUrlPathSegment(calendarId, 'calendarId')}/events${queryString ? `?${queryString}` : ''}`
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
            ...buildEventDetails(event),
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

interface GoogleCalendarListV2Event extends GoogleCalendarEventDetails {
  id: string
  htmlLink: string
  status: string
  summary: string | null
  description: string | null
  location: string | null
  start: GoogleCalendarApiEventResponse['start']
  end: GoogleCalendarApiEventResponse['end']
  attendees: GoogleCalendarApiEventResponse['attendees'] | null
  creator: GoogleCalendarApiEventResponse['creator'] | null
  organizer: GoogleCalendarApiEventResponse['organizer'] | null
}

interface GoogleCalendarListV2Response {
  success: boolean
  output: {
    nextPageToken: string | null
    nextSyncToken: string | null
    timeZone: string | null
    events: GoogleCalendarListV2Event[]
  }
}

export const listV2Tool: ToolConfig<GoogleCalendarListParams, GoogleCalendarListV2Response> = {
  id: 'google_calendar_list_v2',
  name: 'Google Calendar List Events',
  description: 'List events from Google Calendar.',
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
        nextSyncToken: data.nextSyncToken ?? null,
        timeZone: data.timeZone ?? null,
        events: events.map((event: GoogleCalendarApiEventResponse) => ({
          ...buildEventDetails(event),
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
    nextSyncToken: {
      type: 'string',
      description: 'Sync token for incremental sync, returned on the last page',
      optional: true,
    },
    timeZone: { type: 'string', description: 'Calendar time zone', optional: true },
    events: {
      type: 'array',
      description: 'List of events',
      items: {
        type: 'object',
        properties: {
          ...EVENT_DETAIL_OUTPUTS,
          id: { type: 'string', description: 'Event ID' },
          htmlLink: { type: 'string', description: 'Event link' },
          status: { type: 'string', description: 'Event status (confirmed, tentative, cancelled)' },
          summary: { type: 'string', description: 'Event title', optional: true },
          description: { type: 'string', description: 'Event description', optional: true },
          location: { type: 'string', description: 'Event location', optional: true },
          start: { type: 'json', description: 'Event start { dateTime | date, timeZone }' },
          end: { type: 'json', description: 'Event end { dateTime | date, timeZone }' },
          attendees: {
            type: 'json',
            description:
              'Attendees [{ email, displayName, responseStatus (needsAction, declined, tentative, accepted), optional, organizer, self, resource, comment }]',
            optional: true,
          },
          creator: {
            type: 'json',
            description: 'Event creator { email, displayName, self }',
            optional: true,
          },
          organizer: {
            type: 'json',
            description: 'Event organizer { email, displayName, self }',
            optional: true,
          },
        },
      },
    },
  },
}
