import { CALENDAR_API_BASE } from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

interface GoogleCalendarListCalendarsParams {
  accessToken: string
  minAccessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  maxResults?: number
  pageToken?: string
  showDeleted?: boolean
  showHidden?: boolean
}

interface CalendarListEntry {
  kind: string
  etag: string
  id: string
  summary: string
  description?: string
  location?: string
  timeZone: string
  summaryOverride?: string
  colorId: string
  backgroundColor: string
  foregroundColor: string
  hidden?: boolean
  selected?: boolean
  accessRole: string
  defaultReminders: Array<{
    method: string
    minutes: number
  }>
  notificationSettings?: {
    notifications: Array<{
      type: string
      method: string
    }>
  }
  primary?: boolean
  deleted?: boolean
  conferenceProperties?: {
    allowedConferenceSolutionTypes: string[]
  }
}

interface CalendarListApiResponse {
  kind: string
  etag: string
  nextPageToken?: string
  nextSyncToken?: string
  items: CalendarListEntry[]
}

interface GoogleCalendarListCalendarsResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      nextPageToken?: string
      calendars: Array<{
        id: string
        summary: string
        description?: string
        location?: string
        timeZone: string
        accessRole: string
        backgroundColor: string
        foregroundColor: string
        primary?: boolean
        hidden?: boolean
        selected?: boolean
      }>
    }
  }
}

export const listCalendarsTool: ToolConfig<
  GoogleCalendarListCalendarsParams,
  GoogleCalendarListCalendarsResponse
> = {
  id: 'google_calendar_list_calendars',
  name: 'Google Calendar List Calendars',
  description: "List all calendars in the user's calendar list",
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
    minAccessRole: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Minimum access role for returned calendars: freeBusyReader, reader, writer, or owner',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of calendars to return (default 100, max 250)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Token for retrieving subsequent pages of results',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Include deleted calendars',
    },
    showHidden: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Include hidden calendars',
    },
  },

  request: {
    url: (params: GoogleCalendarListCalendarsParams) => {
      const queryParams = new URLSearchParams()

      if (params.minAccessRole) queryParams.append('minAccessRole', params.minAccessRole)
      if (params.maxResults) queryParams.append('maxResults', params.maxResults.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)
      if (params.showDeleted !== undefined)
        queryParams.append('showDeleted', params.showDeleted.toString())
      if (params.showHidden !== undefined)
        queryParams.append('showHidden', params.showHidden.toString())

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/users/me/calendarList${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarListCalendarsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: CalendarListApiResponse = await response.json()
    const calendars = data.items || []
    const calendarsCount = calendars.length

    return {
      success: true,
      output: {
        content: `Found ${calendarsCount} calendar${calendarsCount !== 1 ? 's' : ''}`,
        metadata: {
          nextPageToken: data.nextPageToken,
          calendars: calendars.map((calendar) => ({
            id: calendar.id,
            summary: calendar.summaryOverride || calendar.summary,
            description: calendar.description,
            location: calendar.location,
            timeZone: calendar.timeZone,
            accessRole: calendar.accessRole,
            backgroundColor: calendar.backgroundColor,
            foregroundColor: calendar.foregroundColor,
            primary: calendar.primary,
            hidden: calendar.hidden,
            selected: calendar.selected,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of found calendars count' },
    metadata: {
      type: 'json',
      description: 'List of calendars with their details',
    },
  },
}

interface GoogleCalendarListCalendarsV2Response {
  success: boolean
  output: {
    nextPageToken: string | null
    calendars: Array<{
      id: string
      summary: string
      description: string | null
      location: string | null
      timeZone: string
      accessRole: string
      backgroundColor: string
      foregroundColor: string
      primary: boolean | null
      hidden: boolean | null
      selected: boolean | null
    }>
  }
}

export const listCalendarsV2Tool: ToolConfig<
  GoogleCalendarListCalendarsParams,
  GoogleCalendarListCalendarsV2Response
> = {
  id: 'google_calendar_list_calendars_v2',
  name: 'Google Calendar List Calendars',
  description: "List all calendars in the user's calendar list. Returns API-aligned fields only.",
  version: '2.0.0',
  oauth: listCalendarsTool.oauth,
  params: listCalendarsTool.params,
  request: listCalendarsTool.request,
  transformResponse: async (response: Response) => {
    const data: CalendarListApiResponse = await response.json()
    const calendars = data.items || []

    return {
      success: true,
      output: {
        nextPageToken: data.nextPageToken ?? null,
        calendars: calendars.map((calendar) => ({
          id: calendar.id,
          summary: calendar.summaryOverride || calendar.summary,
          description: calendar.description ?? null,
          location: calendar.location ?? null,
          timeZone: calendar.timeZone,
          accessRole: calendar.accessRole,
          backgroundColor: calendar.backgroundColor,
          foregroundColor: calendar.foregroundColor,
          primary: calendar.primary ?? null,
          hidden: calendar.hidden ?? null,
          selected: calendar.selected ?? null,
        })),
      },
    }
  },
  outputs: {
    nextPageToken: { type: 'string', description: 'Next page token', optional: true },
    calendars: {
      type: 'array',
      description: 'List of calendars',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Calendar ID' },
          summary: { type: 'string', description: 'Calendar title' },
          description: { type: 'string', description: 'Calendar description', optional: true },
          location: { type: 'string', description: 'Calendar location', optional: true },
          timeZone: { type: 'string', description: 'Calendar time zone' },
          accessRole: { type: 'string', description: 'Access role for the calendar' },
          backgroundColor: { type: 'string', description: 'Calendar background color' },
          foregroundColor: { type: 'string', description: 'Calendar foreground color' },
          primary: {
            type: 'boolean',
            description: 'Whether this is the primary calendar',
            optional: true,
          },
          hidden: {
            type: 'boolean',
            description: 'Whether the calendar is hidden',
            optional: true,
          },
          selected: {
            type: 'boolean',
            description: 'Whether the calendar is selected',
            optional: true,
          },
        },
      },
    },
  },
}
