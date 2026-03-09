import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarCreateParams,
  type GoogleCalendarCreateResponse,
  type GoogleCalendarEventRequestBody,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export const createTool: ToolConfig<GoogleCalendarCreateParams, GoogleCalendarCreateResponse> = {
  id: 'google_calendar_create',
  name: 'Google Calendar Create Event',
  description: 'Create a new event in Google Calendar',
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
      description:
        'Start date and time. MUST include timezone offset (e.g., 2025-06-03T10:00:00-08:00) OR provide timeZone parameter',
    },
    endDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End date and time. MUST include timezone offset (e.g., 2025-06-03T11:00:00-08:00) OR provide timeZone parameter',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time zone (e.g., America/Los_Angeles). Required if datetime does not include offset. Defaults to America/Los_Angeles if not provided.',
      default: 'America/Los_Angeles',
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
      // Default timezone if not provided and datetime doesn't include offset
      const timeZone = params.timeZone || 'America/Los_Angeles'
      const needsTimezone =
        !params.startDateTime.includes('+') && !params.startDateTime.includes('-', 10)

      const eventData: GoogleCalendarEventRequestBody = {
        summary: params.summary,
        start: {
          dateTime: params.startDateTime,
          ...(needsTimezone ? { timeZone } : {}),
        },
        end: {
          dateTime: params.endDateTime,
          ...(needsTimezone ? { timeZone } : {}),
        },
      }

      if (params.description) {
        eventData.description = params.description
      }

      if (params.location) {
        eventData.location = params.location
      }

      // Always set timezone if explicitly provided
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

  outputs: {
    content: { type: 'string', description: 'Event creation confirmation message' },
    metadata: {
      type: 'json',
      description: 'Created event metadata including ID, status, and details',
    },
  },
}

interface GoogleCalendarCreateV2Response {
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

export const createV2Tool: ToolConfig<GoogleCalendarCreateParams, GoogleCalendarCreateV2Response> =
  {
    id: 'google_calendar_create_v2',
    name: 'Google Calendar Create Event',
    description: 'Create a new event in Google Calendar. Returns API-aligned fields only.',
    version: '2.0.0',
    oauth: createTool.oauth,
    params: createTool.params,
    request: createTool.request,
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
