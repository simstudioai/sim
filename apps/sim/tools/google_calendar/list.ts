import type { ToolConfig } from '../types'
import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarApiListResponse,
  type GoogleCalendarListParams,
  type GoogleCalendarListResponse,
} from './types'

export const listTool: ToolConfig<GoogleCalendarListParams, GoogleCalendarListResponse> = {
  id: 'google_calendar_list',
  name: 'Google Calendar List Events',
  description: 'List events from Google Calendar',
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
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to list calendar events')
    }

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
    return error.message || 'An unexpected error occurred while listing calendar events'
  },
}
