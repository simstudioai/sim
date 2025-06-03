import type { ToolConfig } from '../types'
import type { GoogleCalendarQuickAddParams, GoogleCalendarToolResponse } from './types'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

export const googleCalendarQuickAddTool: ToolConfig<
  GoogleCalendarQuickAddParams,
  GoogleCalendarToolResponse
> = {
  id: 'google_calendar_quick_add',
  name: 'Google Calendar Quick Add',
  description: 'Create events from natural language text',
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
    text: {
      type: 'string',
      required: true,
      description:
        'Natural language text describing the event (e.g., "Meeting with John tomorrow at 3pm")',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarQuickAddParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      queryParams.append('text', params.text)

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?${queryParams.toString()}`
    },
    method: 'POST',
    headers: (params: GoogleCalendarQuickAddParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create calendar event from text')
    }

    return {
      success: true,
      output: {
        content: `Event "${data.summary}" created successfully from natural language`,
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
    // Handle Google API error format
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
      if (error.error.message.includes('parse')) {
        return 'Could not parse the natural language text. Please try a different format.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while creating the calendar event'
  },
}
