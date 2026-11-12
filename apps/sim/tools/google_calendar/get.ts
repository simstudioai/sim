import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarEventDetails,
  type GoogleCalendarGetParams,
  type GoogleCalendarGetResponse,
} from '@/tools/google_calendar/types'
import { buildEventDetails, EVENT_DETAIL_OUTPUTS } from '@/tools/google_calendar/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTool: ToolConfig<GoogleCalendarGetParams, GoogleCalendarGetResponse> = {
  id: 'google_calendar_get',
  name: 'Google Calendar Get Event',
  description: 'Get a specific event from Google Calendar',
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
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Calendar event ID to retrieve',
    },
  },

  request: {
    url: (params: GoogleCalendarGetParams) => {
      const calendarId = params.calendarId || 'primary'
      return `${CALENDAR_API_BASE}/calendars/${safeUrlPathSegment(calendarId, 'calendarId')}/events/${safeUrlPathSegment(params.eventId, 'eventId')}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarGetParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Retrieved event "${data.summary}"`,
        metadata: {
          ...buildEventDetails(data),
          id: data.id,
          htmlLink: data.htmlLink,
          status: data.status,
          summary: data.summary,
          description: data.description,
          location: data.location,
          start: data.start,
          end: data.end,
          attendees: data.attendees,
          creator: data.creator,
          organizer: data.organizer,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Event retrieval confirmation message' },
    metadata: {
      type: 'json',
      description: 'Event details including ID, status, times, and attendees',
    },
  },
}

interface GoogleCalendarGetV2Response {
  success: boolean
  output: GoogleCalendarEventDetails & {
    id: string
    htmlLink: string
    status: string
    summary: string | null
    description: string | null
    location: string | null
    start: GoogleCalendarApiEventResponse['start']
    end: GoogleCalendarApiEventResponse['end']
    attendees: GoogleCalendarApiEventResponse['attendees'] | null
    creator: GoogleCalendarApiEventResponse['creator']
    organizer: GoogleCalendarApiEventResponse['organizer']
  }
}

export const getV2Tool: ToolConfig<GoogleCalendarGetParams, GoogleCalendarGetV2Response> = {
  id: 'google_calendar_get_v2',
  assistant: { effect: 'read', version: 1 },
  name: 'Google Calendar Get Event',
  description: 'Get a specific event from Google Calendar.',
  version: '2.0.0',
  oauth: getTool.oauth,
  params: getTool.params,
  request: getTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
        ...buildEventDetails(data),
        id: data.id,
        htmlLink: data.htmlLink,
        status: data.status,
        summary: data.summary ?? null,
        description: data.description ?? null,
        location: data.location ?? null,
        start: data.start,
        end: data.end,
        attendees: data.attendees ?? null,
        creator: data.creator,
        organizer: data.organizer,
      },
    }
  },
  outputs: {
    ...EVENT_DETAIL_OUTPUTS,
    id: { type: 'string', description: 'Event ID' },
    htmlLink: { type: 'string', description: 'Event link' },
    status: { type: 'string', description: 'Event status' },
    summary: { type: 'string', description: 'Event title', optional: true },
    description: { type: 'string', description: 'Event description', optional: true },
    location: { type: 'string', description: 'Event location', optional: true },
    start: { type: 'json', description: 'Event start' },
    end: { type: 'json', description: 'Event end' },
    attendees: { type: 'json', description: 'Event attendees', optional: true },
    creator: { type: 'json', description: 'Event creator' },
    organizer: { type: 'json', description: 'Event organizer' },
  },
}
