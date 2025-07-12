import type { ToolConfig } from '../types'
import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarGetParams,
  type GoogleCalendarGetResponse,
} from './types'

export const getTool: ToolConfig<GoogleCalendarGetParams, GoogleCalendarGetResponse> = {
  id: 'google_calendar_get',
  name: 'Google Calendar Get Event',
  description: 'Get a specific event from Google Calendar',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-calendar',
    additionalScopes: ['https://www.googleapis.com/auth/calendar'],
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
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to get calendar event')
    }

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

  transformError: (error) => {
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Google Calendar API quota exceeded. Please try again later.'
      }
      if (error.error.message.includes('Calendar not found')) {
        return 'Calendar not found. Please check the calendar ID.'
      }
      if (
        error.error.message.includes('Event not found') ||
        error.error.message.includes('Not Found')
      ) {
        return 'Event not found. Please check the event ID.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while retrieving the calendar event'
  },
}
