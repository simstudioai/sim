import type {
  GoogleWorkspaceAdminListActivitiesParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  REPORTS_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListActivitiesApiResponse {
  items?: unknown[]
  nextPageToken?: string
}

export const listActivitiesTool: ToolConfig<
  GoogleWorkspaceAdminListActivitiesParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_activities',
  name: 'Google Workspace Admin List Activities',
  description:
    'Read Google Workspace audit activities for an application, such as login, admin, drive, or token events',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-workspace-admin',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    applicationName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Audit log to read, e.g. login, admin, drive, token, groups, mobile, saml, user_accounts, chrome, or meet',
    },
    userKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Profile ID or email address of the user whose activity to read. Defaults to all users',
    },
    eventName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only this event name (e.g. login_failure)',
    },
    actorIpAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only events originating from this IPv4 or IPv6 address',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Oldest activity to return, as an RFC 3339 timestamp',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Newest activity to return, as an RFC 3339 timestamp',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Comma-separated event parameter conditions (e.g. "doc_id==12345"). Supported operators are ==, <>, <, <=, >, and >=',
    },
    orgUnitID: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return only activity for users in this org unit ID',
    },
    groupIdFilter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated obfuscated group IDs to filter activity by',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of activities to return. Example: 100',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
  },

  request: {
    url: (params) => {
      const target = params.userKey ? encodeURIComponent(params.userKey) : 'all'
      const url = new URL(
        `${REPORTS_API_BASE}/activity/users/${target}/applications/${encodeURIComponent(params.applicationName)}`
      )
      appendQueryParams(url, {
        eventName: params.eventName,
        actorIpAddress: params.actorIpAddress,
        startTime: params.startTime,
        endTime: params.endTime,
        filters: params.filters,
        orgUnitID: params.orgUnitID,
        groupIdFilter: params.groupIdFilter,
        maxResults: params.maxResults,
        pageToken: params.pageToken,
      })
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListActivitiesApiResponse>(
      response,
      'Failed to list activities'
    )
    return {
      success: true,
      output: {
        activities: data.items ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    activities: {
      type: 'json',
      description: 'Array of Activity resources',
      items: {
        type: 'json',
        properties: {
          id: {
            type: 'json',
            description:
              'Identifier object with time, uniqueQualifier, applicationName, and customerId',
          },
          actor: {
            type: 'json',
            description: 'Actor object with profileId, email, callerType, key, and applicationInfo',
          },
          ipAddress: { type: 'string', description: 'IP address the action came from' },
          ownerDomain: { type: 'string', description: 'Domain owning the affected resource' },
          events: {
            type: 'json',
            description: 'Events in the activity, each with type, name, and parameters',
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
