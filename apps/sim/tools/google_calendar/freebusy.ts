import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiFreeBusyResponse,
  type GoogleCalendarFreeBusyParams,
  type GoogleCalendarFreeBusyResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export const freebusyTool: ToolConfig<
  GoogleCalendarFreeBusyParams,
  GoogleCalendarFreeBusyResponse
> = {
  id: 'google_calendar_freebusy',
  name: 'Google Calendar Free/Busy',
  description: 'Query free/busy information for one or more Google Calendars',
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
    calendarIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated calendar IDs to query (e.g., "primary,other@example.com")',
    },
    timeMin: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of the time range (RFC3339 timestamp, e.g., 2025-06-03T00:00:00Z)',
    },
    timeMax: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of the time range (RFC3339 timestamp, e.g., 2025-06-04T00:00:00Z)',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA time zone (e.g., "UTC", "America/New_York"). Defaults to UTC.',
    },
  },

  request: {
    url: () => `${CALENDAR_API_BASE}/freeBusy`,
    method: 'POST',
    headers: (params: GoogleCalendarFreeBusyParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarFreeBusyParams) => {
      const ids = params.calendarIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)

      return {
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        timeZone: params.timeZone || 'UTC',
        items: ids.map((id) => ({ id })),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiFreeBusyResponse = await response.json()

    const calendarIds = Object.keys(data.calendars || {})
    const totalBusy = calendarIds.reduce((sum, id) => {
      return sum + (data.calendars[id]?.busy?.length || 0)
    }, 0)

    return {
      success: true,
      output: {
        content: `Found ${totalBusy} busy period${totalBusy !== 1 ? 's' : ''} across ${calendarIds.length} calendar${calendarIds.length !== 1 ? 's' : ''}`,
        metadata: {
          timeMin: data.timeMin,
          timeMax: data.timeMax,
          calendars: data.calendars,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of free/busy results' },
    metadata: {
      type: 'json',
      description: 'Free/busy data with time range and per-calendar busy periods',
    },
  },
}

interface GoogleCalendarFreeBusyV2Response {
  success: boolean
  output: {
    timeMin: string
    timeMax: string
    calendars: Record<
      string,
      {
        busy: Array<{ start: string; end: string }>
        errors?: Array<{ domain: string; reason: string }>
      }
    >
  }
}

export const freebusyV2Tool: ToolConfig<
  GoogleCalendarFreeBusyParams,
  GoogleCalendarFreeBusyV2Response
> = {
  id: 'google_calendar_freebusy_v2',
  name: 'Google Calendar Free/Busy',
  description:
    'Query free/busy information for one or more Google Calendars. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: freebusyTool.oauth,
  params: freebusyTool.params,
  request: freebusyTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiFreeBusyResponse = await response.json()

    return {
      success: true,
      output: {
        timeMin: data.timeMin,
        timeMax: data.timeMax,
        calendars: data.calendars,
      },
    }
  },
  outputs: {
    timeMin: { type: 'string', description: 'Start of the queried time range' },
    timeMax: { type: 'string', description: 'End of the queried time range' },
    calendars: {
      type: 'json',
      description: 'Per-calendar free/busy data with busy periods and any errors',
    },
  },
}
