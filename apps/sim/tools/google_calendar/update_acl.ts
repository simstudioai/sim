import {
  CALENDAR_API_BASE,
  type GoogleCalendarAclRole,
  type GoogleCalendarApiAclRule,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export interface GoogleCalendarUpdateAclParams {
  accessToken: string
  calendarId?: string
  ruleId: string
  role: GoogleCalendarAclRole
  sendNotifications?: boolean
}

export interface GoogleCalendarUpdateAclResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: string
      role: string
      scope: { type: string; value?: string }
    }
  }
}

const buildUpdateAclUrl = (params: GoogleCalendarUpdateAclParams) => {
  const calendarId = params.calendarId?.trim() || 'primary'
  const queryParams = new URLSearchParams()
  if (params.sendNotifications !== undefined) {
    queryParams.append('sendNotifications', String(params.sendNotifications))
  }
  const queryString = queryParams.toString()
  return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(params.ruleId.trim())}${queryString ? `?${queryString}` : ''}`
}

export const updateAclTool: ToolConfig<
  GoogleCalendarUpdateAclParams,
  GoogleCalendarUpdateAclResponse
> = {
  id: 'google_calendar_update_acl',
  name: 'Google Calendar Update Sharing',
  description: 'Change the access role granted by an existing calendar sharing (ACL) rule',
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
      description: 'ACL rule ID to update (e.g., user:person@example.com)',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New access role to grant: freeBusyReader, reader, writer, or owner',
    },
    sendNotifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to send a notification email about the change. Defaults to true.',
    },
  },

  request: {
    url: buildUpdateAclUrl,
    method: 'PATCH',
    headers: (params: GoogleCalendarUpdateAclParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarUpdateAclParams) => ({ role: params.role }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiAclRule = await response.json()

    return {
      success: true,
      output: {
        content: `Updated sharing rule for ${data.scope?.value || data.scope?.type} to ${data.role}`,
        metadata: {
          id: data.id,
          role: data.role,
          scope: data.scope,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Sharing update confirmation message' },
    metadata: {
      type: 'json',
      description: 'Updated ACL rule (id, role, scope)',
    },
  },
}

interface GoogleCalendarUpdateAclV2Response {
  success: boolean
  output: {
    id: string
    role: string
    scope: { type: string; value?: string }
  }
}

export const updateAclV2Tool: ToolConfig<
  GoogleCalendarUpdateAclParams,
  GoogleCalendarUpdateAclV2Response
> = {
  id: 'google_calendar_update_acl_v2',
  name: 'Google Calendar Update Sharing',
  description:
    'Change the access role granted by an existing calendar sharing (ACL) rule. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: updateAclTool.oauth,
  params: updateAclTool.params,
  request: updateAclTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiAclRule = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        role: data.role,
        scope: data.scope,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'ACL rule ID' },
    role: { type: 'string', description: 'Granted access role' },
    scope: { type: 'json', description: 'Grantee scope (type and value)' },
  },
}
