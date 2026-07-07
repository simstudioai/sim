import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiCalendarResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export interface GoogleCalendarUpdateCalendarParams {
  accessToken: string
  calendarId?: string
  summary?: string
  description?: string
  location?: string
  timeZone?: string
}

export interface GoogleCalendarUpdateCalendarResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: string
      summary: string
      description?: string
      location?: string
      timeZone?: string
    }
  }
}

const buildUpdateCalendarUrl = (params: GoogleCalendarUpdateCalendarParams) => {
  const calendarId = params.calendarId?.trim() || 'primary'
  return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}`
}

const buildUpdateCalendarBody = (params: GoogleCalendarUpdateCalendarParams) => {
  const body: Record<string, string> = {}
  if (params.summary !== undefined) body.summary = params.summary
  if (params.description !== undefined) body.description = params.description
  if (params.location !== undefined) body.location = params.location
  if (params.timeZone !== undefined) body.timeZone = params.timeZone
  return body
}

export const updateCalendarTool: ToolConfig<
  GoogleCalendarUpdateCalendarParams,
  GoogleCalendarUpdateCalendarResponse
> = {
  id: 'google_calendar_update_calendar',
  name: 'Google Calendar Update Calendar',
  description: "Update a secondary calendar's metadata (title, description, location, time zone)",
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
      description: 'Calendar ID to update (e.g., primary or calendar@group.calendar.google.com)',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the calendar',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the calendar',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New geographic location of the calendar as free-form text',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New time zone of the calendar as an IANA name (e.g., America/Los_Angeles)',
    },
  },

  request: {
    url: buildUpdateCalendarUrl,
    method: 'PATCH',
    headers: (params: GoogleCalendarUpdateCalendarParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: buildUpdateCalendarBody,
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiCalendarResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Calendar "${data.summary}" updated successfully`,
        metadata: {
          id: data.id,
          summary: data.summary,
          description: data.description,
          location: data.location,
          timeZone: data.timeZone,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Calendar update confirmation message' },
    metadata: {
      type: 'json',
      description: 'Updated calendar metadata (id, summary, description, location, timeZone)',
    },
  },
}

interface GoogleCalendarUpdateCalendarV2Response {
  success: boolean
  output: {
    id: string
    summary: string
    description: string | null
    location: string | null
    timeZone: string | null
  }
}

export const updateCalendarV2Tool: ToolConfig<
  GoogleCalendarUpdateCalendarParams,
  GoogleCalendarUpdateCalendarV2Response
> = {
  id: 'google_calendar_update_calendar_v2',
  name: 'Google Calendar Update Calendar',
  description: "Update a secondary calendar's metadata. Returns API-aligned fields only.",
  version: '2.0.0',
  oauth: updateCalendarTool.oauth,
  params: updateCalendarTool.params,
  request: updateCalendarTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiCalendarResponse = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        summary: data.summary,
        description: data.description ?? null,
        location: data.location ?? null,
        timeZone: data.timeZone ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Calendar ID' },
    summary: { type: 'string', description: 'Calendar title' },
    description: { type: 'string', description: 'Calendar description', optional: true },
    location: { type: 'string', description: 'Calendar location', optional: true },
    timeZone: { type: 'string', description: 'Calendar time zone', optional: true },
  },
}
