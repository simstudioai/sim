import {
  CALENDAR_API_BASE,
  type GoogleCalendarApiAclListResponse,
  type GoogleCalendarListAclParams,
  type GoogleCalendarListAclResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig } from '@/tools/types'

export const listAclTool: ToolConfig<GoogleCalendarListAclParams, GoogleCalendarListAclResponse> = {
  id: 'google_calendar_list_acl',
  name: 'Google Calendar List Sharing',
  description: 'List the access control rules (sharing) for a calendar',
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
      description: 'Calendar ID to inspect (e.g., primary or calendar@group.calendar.google.com)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of ACL rules to return',
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
      visibility: 'user-only',
      description: 'Include deleted ACL rules (with role "none")',
    },
  },

  request: {
    url: (params: GoogleCalendarListAclParams) => {
      const calendarId = params.calendarId?.trim() || 'primary'
      const queryParams = new URLSearchParams()
      if (params.maxResults) queryParams.append('maxResults', params.maxResults.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)
      if (params.showDeleted !== undefined)
        queryParams.append('showDeleted', params.showDeleted.toString())
      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/acl${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarListAclParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiAclListResponse = await response.json()
    const rules = data.items || []
    const rulesCount = rules.length

    return {
      success: true,
      output: {
        content: `Found ${rulesCount} sharing rule${rulesCount !== 1 ? 's' : ''}`,
        metadata: {
          nextPageToken: data.nextPageToken,
          rules: rules.map((rule) => ({
            id: rule.id,
            role: rule.role,
            scope: rule.scope,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of found sharing rules count' },
    metadata: {
      type: 'json',
      description: 'List of ACL rules with pagination token',
    },
  },
}

interface GoogleCalendarListAclV2Response {
  success: boolean
  output: {
    nextPageToken: string | null
    rules: Array<{ id: string; role: string; scope: { type: string; value?: string } }>
  }
}

export const listAclV2Tool: ToolConfig<
  GoogleCalendarListAclParams,
  GoogleCalendarListAclV2Response
> = {
  id: 'google_calendar_list_acl_v2',
  name: 'Google Calendar List Sharing',
  description:
    'List the access control rules (sharing) for a calendar. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: listAclTool.oauth,
  params: listAclTool.params,
  request: listAclTool.request,
  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiAclListResponse = await response.json()
    const rules = data.items || []

    return {
      success: true,
      output: {
        nextPageToken: data.nextPageToken ?? null,
        rules: rules.map((rule) => ({
          id: rule.id,
          role: rule.role,
          scope: rule.scope,
        })),
      },
    }
  },
  outputs: {
    nextPageToken: { type: 'string', description: 'Next page token', optional: true },
    rules: {
      type: 'array',
      description: 'List of ACL rules',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ACL rule ID' },
          role: { type: 'string', description: 'Access role' },
          scope: { type: 'json', description: 'Grantee scope (type and value)' },
        },
      },
    },
  },
}
