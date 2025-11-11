import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarGetParams,
  type GoogleCalendarGetResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-only',
      description: 'Calendar ID (defaults to primary)',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Event ID to retrieve',
    },
  },

  request: {
    url: (params: GoogleCalendarGetParams) => {
      const calendarId = params.calendarId || 'primary'
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}`
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
