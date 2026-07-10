import { CALENDAR_API_BASE } from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export interface GoogleCalendarDeleteCalendarParams {
  accessToken: string
  calendarId: string
}

interface GoogleCalendarDeleteCalendarResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      calendarId: string
      deleted: boolean
    }
  }
}

const buildDeleteCalendarUrl = (params: GoogleCalendarDeleteCalendarParams) =>
  `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(params.calendarId.trim())}`

export const deleteCalendarTool: ToolConfig<
  GoogleCalendarDeleteCalendarParams,
  GoogleCalendarDeleteCalendarResponse
> = {
  id: 'google_calendar_delete_calendar',
  name: 'Google Calendar Delete Calendar',
  description: 'Permanently delete a secondary calendar (not the primary calendar)',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Secondary calendar ID to delete (e.g., calendar@group.calendar.google.com). The primary calendar cannot be deleted.',
    },
  },

  request: {
    url: buildDeleteCalendarUrl,
    method: 'DELETE',
    headers: (params: GoogleCalendarDeleteCalendarParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          content: 'Calendar successfully deleted',
          metadata: {
            calendarId: params?.calendarId || '',
            deleted: true,
          },
        },
      }
    }

    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'Failed to delete calendar')
  },

  outputs: {
    content: { type: 'string', description: 'Calendar deletion confirmation message' },
    metadata: {
      type: 'json',
      description: 'Deletion details including calendar ID',
    },
  },
}

interface GoogleCalendarDeleteCalendarV2Response {
  success: boolean
  output: {
    calendarId: string
    deleted: boolean
  }
}

export const deleteCalendarV2Tool: ToolConfig<
  GoogleCalendarDeleteCalendarParams,
  GoogleCalendarDeleteCalendarV2Response
> = {
  id: 'google_calendar_delete_calendar_v2',
  name: 'Google Calendar Delete Calendar',
  description: 'Permanently delete a secondary calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: deleteCalendarTool.oauth,
  params: deleteCalendarTool.params,
  request: deleteCalendarTool.request,
  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          calendarId: params?.calendarId || '',
          deleted: true,
        },
      }
    }

    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'Failed to delete calendar')
  },
  outputs: {
    calendarId: { type: 'string', description: 'Deleted calendar ID' },
    deleted: { type: 'boolean', description: 'Whether deletion was successful' },
  },
}
