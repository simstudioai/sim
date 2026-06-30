import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiCalendarResponse,
  type GoogleCalendarCreateCalendarParams,
  type GoogleCalendarCreateCalendarResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export const createCalendarTool: ToolConfig<
  GoogleCalendarCreateCalendarParams,
  GoogleCalendarCreateCalendarResponse
> = {
  id: 'google_calendar_create_calendar',
  name: 'Google Calendar Create Calendar',
  description: 'Create a new secondary calendar',
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
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the new calendar',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the new calendar',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Geographic location of the calendar as free-form text',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time zone of the calendar as an IANA name (e.g., America/Los_Angeles)',
    },
  },

  request: {
    url: () => `${CALENDAR_API_BASE}/calendars`,
    method: 'POST',
    headers: (params: GoogleCalendarCreateCalendarParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarCreateCalendarParams) => {
      const body: Record<string, string> = { summary: params.summary }
      if (params.description) body.description = params.description
      if (params.location) body.location = params.location
      if (params.timeZone) body.timeZone = params.timeZone
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiCalendarResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Calendar "${data.summary}" created successfully`,
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
    content: { type: 'string', description: 'Calendar creation confirmation message' },
    metadata: {
      type: 'json',
      description: 'Created calendar metadata (id, summary, description, location, timeZone)',
    },
  },
}

interface GoogleCalendarCreateCalendarV2Response {
  success: boolean
  output: {
    id: string
    summary: string
    description: string | null
    location: string | null
    timeZone: string | null
  }
}

export const createCalendarV2Tool: ToolConfig<
  GoogleCalendarCreateCalendarParams,
  GoogleCalendarCreateCalendarV2Response
> = {
  id: 'google_calendar_create_calendar_v2',
  name: 'Google Calendar Create Calendar',
  description: 'Create a new secondary calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: createCalendarTool.oauth,
  params: createCalendarTool.params,
  request: createCalendarTool.request,
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
