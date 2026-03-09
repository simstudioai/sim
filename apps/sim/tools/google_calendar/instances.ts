import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiEventResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

interface GoogleCalendarInstancesParams {
  accessToken: string
  calendarId?: string
  eventId: string
  timeMin?: string
  timeMax?: string
  maxResults?: number
  pageToken?: string
  showDeleted?: boolean
}

interface GoogleCalendarInstancesResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      nextPageToken?: string
      timeZone: string
      instances: Array<{
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
        recurringEventId: string
        originalStartTime: {
          dateTime?: string
          date?: string
          timeZone?: string
        }
      }>
    }
  }
}

interface InstanceApiResponse {
  kind: string
  etag: string
  summary: string
  description?: string
  updated: string
  timeZone: string
  accessRole: string
  nextPageToken?: string
  items: Array<
    GoogleCalendarApiEventResponse & {
      recurringEventId: string
      originalStartTime: {
        dateTime?: string
        date?: string
        timeZone?: string
      }
    }
  >
}

export const instancesTool: ToolConfig<
  GoogleCalendarInstancesParams,
  GoogleCalendarInstancesResponse
> = {
  id: 'google_calendar_instances',
  name: 'Google Calendar Get Instances',
  description: 'Get instances of a recurring event from Google Calendar',
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
      description: 'Recurring event ID to get instances of',
    },
    timeMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lower bound for instances (RFC3339 timestamp, e.g., 2025-06-03T00:00:00Z)',
    },
    timeMax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Upper bound for instances (RFC3339 timestamp, e.g., 2025-06-04T00:00:00Z)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of instances to return (default 250, max 2500)',
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
      description: 'Include deleted instances',
    },
  },

  request: {
    url: (params: GoogleCalendarInstancesParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.timeMin) queryParams.append('timeMin', params.timeMin)
      if (params.timeMax) queryParams.append('timeMax', params.timeMax)
      if (params.maxResults) queryParams.append('maxResults', params.maxResults.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)
      if (params.showDeleted !== undefined)
        queryParams.append('showDeleted', params.showDeleted.toString())

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}/instances${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarInstancesParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: InstanceApiResponse = await response.json()
    const instances = data.items || []
    const instancesCount = instances.length

    return {
      success: true,
      output: {
        content: `Found ${instancesCount} instance${instancesCount !== 1 ? 's' : ''} of the recurring event`,
        metadata: {
          nextPageToken: data.nextPageToken,
          timeZone: data.timeZone,
          instances: instances.map((instance) => ({
            id: instance.id,
            htmlLink: instance.htmlLink,
            status: instance.status,
            summary: instance.summary || 'No title',
            description: instance.description,
            location: instance.location,
            start: instance.start,
            end: instance.end,
            attendees: instance.attendees,
            creator: instance.creator,
            organizer: instance.organizer,
            recurringEventId: instance.recurringEventId,
            originalStartTime: instance.originalStartTime,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of found instances count' },
    metadata: {
      type: 'json',
      description: 'List of recurring event instances with pagination tokens',
    },
  },
}

interface GoogleCalendarInstancesV2Response {
  success: boolean
  output: {
    nextPageToken: string | null
    timeZone: string | null
    instances: Array<Record<string, any>>
  }
}

export const instancesV2Tool: ToolConfig<
  GoogleCalendarInstancesParams,
  GoogleCalendarInstancesV2Response
> = {
  id: 'google_calendar_instances_v2',
  name: 'Google Calendar Get Instances',
  description:
    'Get instances of a recurring event from Google Calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: instancesTool.oauth,
  params: instancesTool.params,
  request: instancesTool.request,
  transformResponse: async (response: Response) => {
    const data: InstanceApiResponse = await response.json()
    const instances = data.items || []

    return {
      success: true,
      output: {
        nextPageToken: data.nextPageToken ?? null,
        timeZone: data.timeZone ?? null,
        instances: instances.map((instance) => ({
          id: instance.id,
          htmlLink: instance.htmlLink,
          status: instance.status,
          summary: instance.summary ?? null,
          description: instance.description ?? null,
          location: instance.location ?? null,
          start: instance.start,
          end: instance.end,
          attendees: instance.attendees ?? null,
          creator: instance.creator,
          organizer: instance.organizer,
          recurringEventId: instance.recurringEventId,
          originalStartTime: instance.originalStartTime,
        })),
      },
    }
  },
  outputs: {
    nextPageToken: { type: 'string', description: 'Next page token', optional: true },
    timeZone: { type: 'string', description: 'Calendar time zone', optional: true },
    instances: { type: 'json', description: 'List of recurring event instances' },
  },
}
