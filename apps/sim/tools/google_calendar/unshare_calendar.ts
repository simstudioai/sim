import {
  CALENDAR_API_BASE,
  type GoogleCalendarUnshareCalendarParams,
  type GoogleCalendarUnshareCalendarResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

const buildUnshareUrl = (params: GoogleCalendarUnshareCalendarParams) => {
  const calendarId = params.calendarId?.trim() || 'primary'
  return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(params.ruleId.trim())}`
}

export const unshareCalendarTool: ToolConfig<
  GoogleCalendarUnshareCalendarParams,
  GoogleCalendarUnshareCalendarResponse
> = {
  id: 'google_calendar_unshare_calendar',
  name: 'Google Calendar Remove Sharing',
  description: 'Revoke an access control rule (sharing) from a calendar',
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
      description: 'Calendar ID to modify (e.g., primary or calendar@group.calendar.google.com)',
    },
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ACL rule ID to remove (e.g., user:person@example.com)',
    },
  },

  request: {
    url: buildUnshareUrl,
    method: 'DELETE',
    headers: (params: GoogleCalendarUnshareCalendarParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          content: 'Sharing rule successfully removed',
          metadata: {
            ruleId: params?.ruleId || '',
            deleted: true,
          },
        },
      }
    }

    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'Failed to remove sharing rule')
  },

  outputs: {
    content: { type: 'string', description: 'Removal confirmation message' },
    metadata: {
      type: 'json',
      description: 'Removal details including rule ID',
    },
  },
}

interface GoogleCalendarUnshareCalendarV2Response {
  success: boolean
  output: {
    ruleId: string
    deleted: boolean
  }
}

export const unshareCalendarV2Tool: ToolConfig<
  GoogleCalendarUnshareCalendarParams,
  GoogleCalendarUnshareCalendarV2Response
> = {
  id: 'google_calendar_unshare_calendar_v2',
  name: 'Google Calendar Remove Sharing',
  description:
    'Revoke an access control rule (sharing) from a calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: unshareCalendarTool.oauth,
  params: unshareCalendarTool.params,
  request: unshareCalendarTool.request,
  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          ruleId: params?.ruleId || '',
          deleted: true,
        },
      }
    }

    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'Failed to remove sharing rule')
  },
  outputs: {
    ruleId: { type: 'string', description: 'Removed ACL rule ID' },
    deleted: { type: 'boolean', description: 'Whether removal was successful' },
  },
}
