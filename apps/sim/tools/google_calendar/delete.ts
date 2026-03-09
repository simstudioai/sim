import { CALENDAR_API_BASE, type GoogleCalendarDeleteParams } from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

interface GoogleCalendarDeleteResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      eventId: string
      deleted: boolean
    }
  }
}

export const deleteTool: ToolConfig<GoogleCalendarDeleteParams, GoogleCalendarDeleteResponse> = {
  id: 'google_calendar_delete',
  name: 'Google Calendar Delete Event',
  description: 'Delete an event from Google Calendar',
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
      description: 'Google Calendar event ID to delete',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarDeleteParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}${queryString ? `?${queryString}` : ''}`
    },
    method: 'DELETE',
    headers: (params: GoogleCalendarDeleteParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    // DELETE returns 204 No Content on success
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          content: `Event successfully deleted`,
          metadata: {
            eventId: params?.eventId || '',
            deleted: true,
          },
        },
      }
    }

    const errorData = await response.json()
    throw new Error(errorData.error?.message || 'Failed to delete event')
  },

  outputs: {
    content: { type: 'string', description: 'Event deletion confirmation message' },
    metadata: {
      type: 'json',
      description: 'Deletion details including event ID',
    },
  },
}

interface GoogleCalendarDeleteV2Response {
  success: boolean
  output: {
    eventId: string
    deleted: boolean
  }
}

export const deleteV2Tool: ToolConfig<GoogleCalendarDeleteParams, GoogleCalendarDeleteV2Response> =
  {
    id: 'google_calendar_delete_v2',
    name: 'Google Calendar Delete Event',
    description: 'Delete an event from Google Calendar. Returns API-aligned fields only.',
    version: '2.0.0',
    oauth: deleteTool.oauth,
    params: deleteTool.params,
    request: deleteTool.request,
    transformResponse: async (response: Response, params) => {
      if (response.status === 204 || response.ok) {
        return {
          success: true,
          output: {
            eventId: params?.eventId || '',
            deleted: true,
          },
        }
      }

      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to delete event')
    },
    outputs: {
      eventId: { type: 'string', description: 'Deleted event ID' },
      deleted: { type: 'boolean', description: 'Whether deletion was successful' },
    },
  }
