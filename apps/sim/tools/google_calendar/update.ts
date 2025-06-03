import type { ToolConfig } from '../types'
import {
  CALENDAR_API_BASE,
  type GoogleCalendarToolResponse,
  type GoogleCalendarUpdateParams,
} from './types'

export const updateTool: ToolConfig<GoogleCalendarUpdateParams, GoogleCalendarToolResponse> = {
  id: 'google_calendar_update',
  name: 'Google Calendar Update Event',
  description: 'Update an existing event in Google Calendar',
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
      description: 'Access token for Google Calendar API',
    },
    calendarId: {
      type: 'string',
      required: false,
      description: 'Calendar ID (defaults to primary)',
    },
    eventId: {
      type: 'string',
      required: true,
      description: 'Event ID to update',
    },
    summary: {
      type: 'string',
      required: false,
      description: 'Event title/summary',
    },
    description: {
      type: 'string',
      required: false,
      description: 'Event description',
    },
    location: {
      type: 'string',
      required: false,
      description: 'Event location',
    },
    startDateTime: {
      type: 'string',
      required: false,
      description: 'Start date and time (RFC3339 format, e.g., 2025-06-03T10:00:00-08:00)',
    },
    endDateTime: {
      type: 'string',
      required: false,
      description: 'End date and time (RFC3339 format, e.g., 2025-06-03T11:00:00-08:00)',
    },
    timeZone: {
      type: 'string',
      required: false,
      description: 'Time zone (e.g., America/Los_Angeles)',
    },
    attendees: {
      type: 'array',
      required: false,
      description: 'Array of attendee email addresses',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarUpdateParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}${queryString ? `?${queryString}` : ''}`
    },
    method: 'PUT',
    headers: (params: GoogleCalendarUpdateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarUpdateParams): Record<string, any> => {
      const eventData: any = {}

      // Only include fields that are provided and not empty
      if (params.summary !== undefined && params.summary !== null && params.summary.trim() !== '') {
        eventData.summary = params.summary
      }

      if (
        params.description !== undefined &&
        params.description !== null &&
        params.description.trim() !== ''
      ) {
        eventData.description = params.description
      }

      if (
        params.location !== undefined &&
        params.location !== null &&
        params.location.trim() !== ''
      ) {
        eventData.location = params.location
      }

      // Only update times if both start and end are provided (Google Calendar requires both)
      const hasStartTime =
        params.startDateTime !== undefined &&
        params.startDateTime !== null &&
        params.startDateTime.trim() !== ''
      const hasEndTime =
        params.endDateTime !== undefined &&
        params.endDateTime !== null &&
        params.endDateTime.trim() !== ''

      if (hasStartTime && hasEndTime) {
        eventData.start = {
          dateTime: params.startDateTime,
        }
        eventData.end = {
          dateTime: params.endDateTime,
        }
        if (params.timeZone) {
          eventData.start.timeZone = params.timeZone
          eventData.end.timeZone = params.timeZone
        }
      }

      if (params.attendees !== undefined && params.attendees !== null) {
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

        // Only update attendees if we have valid entries, otherwise preserve existing
        if (attendeeList.length > 0) {
          eventData.attendees = attendeeList.map((email: string) => ({ email }))
        }
      }

      return eventData
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to update calendar event')
    }

    return {
      success: true,
      output: {
        content: `Event "${data.summary}" updated successfully`,
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
    return error.message || 'An unexpected error occurred while updating the calendar event'
  },
}
