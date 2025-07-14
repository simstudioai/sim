import type { ToolConfig } from '../types'
import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarCreateParams,
  type GoogleCalendarCreateResponse,
  type GoogleCalendarEventRequestBody,
} from './types'

export const createTool: ToolConfig<GoogleCalendarCreateParams, GoogleCalendarCreateResponse> = {
  id: 'google_calendar_create',
  name: 'Google Calendar Create Event',
  description: 'Create a new event in Google Calendar',
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
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event title/summary',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event description',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event location',
    },
    startDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date and time (RFC3339 format, e.g., 2025-06-03T10:00:00-08:00)',
    },
    endDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date and time (RFC3339 format, e.g., 2025-06-03T11:00:00-08:00)',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time zone (e.g., America/Los_Angeles)',
    },
    attendees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of attendee email addresses',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarCreateParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      const queryString = queryParams.toString()
      const finalUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events${queryString ? `?${queryString}` : ''}`

      return finalUrl
    },
    method: 'POST',
    headers: (params: GoogleCalendarCreateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarCreateParams): GoogleCalendarEventRequestBody => {
      const eventData: GoogleCalendarEventRequestBody = {
        summary: params.summary,
        start: {
          dateTime: params.startDateTime,
        },
        end: {
          dateTime: params.endDateTime,
        },
      }

      if (params.description) {
        eventData.description = params.description
      }

      if (params.location) {
        eventData.location = params.location
      }

      if (params.timeZone) {
        eventData.start.timeZone = params.timeZone
        eventData.end.timeZone = params.timeZone
      }

      // Handle both string and array cases for attendees
      let attendeeList: string[] = []
      if (params.attendees) {
        const attendees = params.attendees as string | string[]
        if (Array.isArray(attendees)) {
          attendeeList = attendees.filter((email: string) => email && email.trim().length > 0)
        } else if (typeof attendees === 'string' && attendees.trim().length > 0) {
          // Convert comma-separated string to array
          attendeeList = attendees
            .split(',')
            .map((email: string) => email.trim())
            .filter((email: string) => email.length > 0)
        }
      }

      if (attendeeList.length > 0) {
        eventData.attendees = attendeeList.map((email: string) => ({ email }))
      }

      return eventData
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to create calendar event')
    }

    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Event "${data.summary}" created successfully`,
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
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while creating the calendar event'
  },
}
