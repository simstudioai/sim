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
      description: 'Event ID to update',
    },
    summary: {
      type: 'string',
      required: false,
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date and time (RFC3339 format, e.g., 2025-06-03T10:00:00-08:00)',
    },
    endDateTime: {
      type: 'string',
      required: false,
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
      description: 'Array of attendee email addresses (replaces all existing attendees)',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarUpdateParams) => {
      const calendarId = params.calendarId || 'primary'
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarUpdateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const existingEvent = await response.json()

    if (!response.ok) {
      throw new Error(existingEvent.error?.message || 'Failed to fetch existing event')
    }

    // Start with the complete existing event to preserve all fields
    const updatedEvent = { ...existingEvent }

    // Apply updates only for fields that are provided and not empty
    if (
      params?.summary !== undefined &&
      params?.summary !== null &&
      params?.summary.trim() !== ''
    ) {
      updatedEvent.summary = params.summary
    }

    if (
      params?.description !== undefined &&
      params?.description !== null &&
      params?.description.trim() !== ''
    ) {
      updatedEvent.description = params.description
    }

    if (
      params?.location !== undefined &&
      params?.location !== null &&
      params?.location.trim() !== ''
    ) {
      updatedEvent.location = params.location
    }

    // Only update times if both start and end are provided (Google Calendar requires both)
    const hasStartTime =
      params?.startDateTime !== undefined &&
      params?.startDateTime !== null &&
      params?.startDateTime.trim() !== ''
    const hasEndTime =
      params?.endDateTime !== undefined &&
      params?.endDateTime !== null &&
      params?.endDateTime.trim() !== ''

    if (hasStartTime && hasEndTime) {
      updatedEvent.start = {
        dateTime: params.startDateTime,
      }
      updatedEvent.end = {
        dateTime: params.endDateTime,
      }
      if (params?.timeZone) {
        updatedEvent.start.timeZone = params.timeZone
        updatedEvent.end.timeZone = params.timeZone
      }
    }

    // Handle attendees update - this replaces all existing attendees
    if (params?.attendees !== undefined && params?.attendees !== null) {
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

      // Replace all attendees with the new list
      if (attendeeList.length > 0) {
        updatedEvent.attendees = attendeeList.map((email: string) => ({
          email,
          responseStatus: 'needsAction',
        }))
      } else {
        // If empty attendee list is provided, remove all attendees
        updatedEvent.attendees = []
      }
    }

    // Remove read-only fields that shouldn't be included in updates
    const readOnlyFields = [
      'id',
      'etag',
      'kind',
      'created',
      'updated',
      'htmlLink',
      'iCalUID',
      'sequence',
      'creator',
      'organizer',
    ]
    readOnlyFields.forEach((field) => {
      delete updatedEvent[field]
    })

    // Construct PUT URL with query parameters
    const calendarId = params?.calendarId || 'primary'
    const queryParams = new URLSearchParams()
    if (params?.sendUpdates !== undefined) {
      queryParams.append('sendUpdates', params.sendUpdates)
    }

    const queryString = queryParams.toString()
    const putUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params?.eventId || '')}${queryString ? `?${queryString}` : ''}`

    // Send PUT request to update the event
    const putResponse = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${params?.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    })

    if (!putResponse.ok) {
      const errorData = await putResponse.json()
      throw new Error(errorData.error?.message || 'Failed to update calendar event')
    }

    const data = await putResponse.json()

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
      if (error.error.message.includes('Failed to fetch existing event')) {
        return `Unable to retrieve existing event details: ${error.error.message}`
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while updating the calendar event'
  },
}
