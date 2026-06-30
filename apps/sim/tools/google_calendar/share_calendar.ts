import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiAclRule,
  type GoogleCalendarShareCalendarParams,
  type GoogleCalendarShareCalendarResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

const buildAclBody = (params: GoogleCalendarShareCalendarParams) => {
  const scope: { type: string; value?: string } = { type: params.scopeType }
  if (params.scopeType !== 'default') {
    const value = params.scopeValue?.trim()
    if (!value) {
      throw new Error(
        `A grantee is required when scope type is "${params.scopeType}". Provide an email (user/group) or domain name in scopeValue.`
      )
    }
    scope.value = value
  }
  return { role: params.role, scope }
}

const buildAclUrl = (params: GoogleCalendarShareCalendarParams) => {
  const calendarId = params.calendarId?.trim() || 'primary'
  const queryParams = new URLSearchParams()
  if (params.sendNotifications !== undefined) {
    queryParams.append('sendNotifications', String(params.sendNotifications))
  }
  const queryString = queryParams.toString()
  return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/acl${queryString ? `?${queryString}` : ''}`
}

export const shareCalendarTool: ToolConfig<
  GoogleCalendarShareCalendarParams,
  GoogleCalendarShareCalendarResponse
> = {
  id: 'google_calendar_share_calendar',
  name: 'Google Calendar Share Calendar',
  description: 'Grant a user, group, or domain access to a calendar by creating an ACL rule',
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
      description: 'Calendar ID to share (e.g., primary or calendar@group.calendar.google.com)',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Access role to grant: freeBusyReader, reader, writer, or owner',
    },
    scopeType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of grantee: user, group, domain, or default (public)',
    },
    scopeValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Email (user/group), domain name (domain), or empty for default. Required unless scope type is default.',
    },
    sendNotifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to send a notification email about the change. Defaults to true.',
    },
  },

  request: {
    url: buildAclUrl,
    method: 'POST',
    headers: (params: GoogleCalendarShareCalendarParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: buildAclBody,
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiAclRule = await response.json()

    return {
      success: true,
      output: {
        content: `Granted ${data.role} access to ${data.scope?.value || data.scope?.type}`,
        metadata: {
          id: data.id,
          role: data.role,
          scope: data.scope,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Sharing confirmation message' },
    metadata: {
      type: 'json',
      description: 'Created ACL rule (id, role, scope)',
    },
  },
}

interface GoogleCalendarShareCalendarV2Response {
  success: boolean
  output: {
    id: string
    role: string
    scope: { type: string; value?: string }
  }
}

export const shareCalendarV2Tool: ToolConfig<
  GoogleCalendarShareCalendarParams,
  GoogleCalendarShareCalendarV2Response
> = {
  id: 'google_calendar_share_calendar_v2',
  name: 'Google Calendar Share Calendar',
  description:
    'Grant a user, group, or domain access to a calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: shareCalendarTool.oauth,
  params: shareCalendarTool.params,
  request: shareCalendarTool.request,
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
