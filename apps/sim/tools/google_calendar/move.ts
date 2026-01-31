import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

interface GoogleCalendarMoveParams {
  accessToken: string
  calendarId?: string
  eventId: string
  destinationCalendarId: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

interface GoogleCalendarMoveResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: string
      htmlLink: string
      status: string
      summary: string
      description?: string
      location?: string
      start: {
        dateTime?: string
        date?: string
        timeZone?: string
      }
      end: {
        dateTime?: string
        date?: string
        timeZone?: string
      }
      attendees?: Array<{
        email: string
        displayName?: string
        responseStatus: string
      }>
      creator?: {
        email: string
        displayName?: string
      }
      organizer?: {
        email: string
        displayName?: string
      }
    }
  }
}

export const moveTool: ToolConfig<GoogleCalendarMoveParams, GoogleCalendarMoveResponse> = {
  id: 'google_calendar_move',
  name: 'Google Calendar Move Event',
  description: 'Move an event to a different calendar',
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
      description:
        'Source Google Calendar ID (e.g., primary or calendar@group.calendar.google.com)',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Calendar event ID to move',
    },
    destinationCalendarId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination Google Calendar ID',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarMoveParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      queryParams.append('destination', params.destinationCalendarId)

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}/move?${queryParams.toString()}`
    },
    method: 'POST',
    headers: (params: GoogleCalendarMoveParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Event "${data.summary}" moved successfully`,
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
    content: { type: 'string', description: 'Event move confirmation message' },
    metadata: {
      type: 'json',
      description: 'Moved event metadata including new details',
    },
  },
}

interface GoogleCalendarMoveV2Response {
  success: boolean
  output: {
    id: string
    htmlLink: string
    status: string
    summary: string | null
    description: string | null
    location: string | null
    start: any
    end: any
    attendees: any | null
    creator: any
    organizer: any
  }
}

export const moveV2Tool: ToolConfig<GoogleCalendarMoveParams, GoogleCalendarMoveV2Response> = {
  id: 'google_calendar_move_v2',
  name: 'Google Calendar Move Event',
  description: 'Move an event to a different calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: moveTool.oauth,
  params: moveTool.params,
  request: moveTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
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
