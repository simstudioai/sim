import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarUpdateParams,
  type GoogleCalendarUpdateResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<GoogleCalendarUpdateParams, GoogleCalendarUpdateResponse> = {
  id: 'google_calendar_update',
  name: 'Google Calendar Update Event',
  description: 'Update an existing event in Google Calendar',
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
      description: 'Google Calendar event ID to update',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event title/summary',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event description',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event location',
    },
    startDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New start date and time. MUST include timezone offset (e.g., 2025-06-03T10:00:00-08:00) OR provide timeZone parameter',
    },
    endDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New end date and time. MUST include timezone offset (e.g., 2025-06-03T11:00:00-08:00) OR provide timeZone parameter',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time zone (e.g., America/Los_Angeles). Required if datetime does not include offset.',
    },
    attendees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of attendee email addresses (replaces existing attendees)',
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
      const queryParams = new URLSearchParams()

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}${queryString ? `?${queryString}` : ''}`
    },
    method: 'PATCH',
    headers: (params: GoogleCalendarUpdateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarUpdateParams) => {
      const updateData: Record<string, unknown> = {}

      if (params.summary !== undefined) {
        updateData.summary = params.summary
      }

      if (params.description !== undefined) {
        updateData.description = params.description
      }

      if (params.location !== undefined) {
        updateData.location = params.location
      }

      if (params.startDateTime !== undefined) {
        const needsTimezone =
          !params.startDateTime.includes('+') && !params.startDateTime.includes('-', 10)
        updateData.start = {
          dateTime: params.startDateTime,
          ...(needsTimezone && params.timeZone ? { timeZone: params.timeZone } : {}),
        }
      }

      if (params.endDateTime !== undefined) {
        const needsTimezone =
          !params.endDateTime.includes('+') && !params.endDateTime.includes('-', 10)
        updateData.end = {
          dateTime: params.endDateTime,
          ...(needsTimezone && params.timeZone ? { timeZone: params.timeZone } : {}),
        }
      }

      // Handle attendees - convert to array format
      if (params.attendees !== undefined) {
        let attendeeList: string[] = []
        const attendees = params.attendees as string | string[]

        if (Array.isArray(attendees)) {
          attendeeList = attendees.filter((email: string) => email && email.trim().length > 0)
        } else if (typeof attendees === 'string' && attendees.trim().length > 0) {
          attendeeList = attendees
            .split(',')
            .map((email: string) => email.trim())
            .filter((email: string) => email.length > 0)
        }

        updateData.attendees = attendeeList.map((email: string) => ({ email }))
      }

      return updateData
    },
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

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

  outputs: {
    content: { type: 'string', description: 'Event update confirmation message' },
    metadata: {
      type: 'json',
      description: 'Updated event metadata including ID, status, and details',
    },
  },
}

interface GoogleCalendarUpdateV2Response {
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

export const updateV2Tool: ToolConfig<GoogleCalendarUpdateParams, GoogleCalendarUpdateV2Response> =
  {
    id: 'google_calendar_update_v2',
    name: 'Google Calendar Update Event',
    description: 'Update an existing event in Google Calendar. Returns API-aligned fields only.',
    version: '2.0.0',
    oauth: updateTool.oauth,
    params: updateTool.params,
    request: updateTool.request,
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
