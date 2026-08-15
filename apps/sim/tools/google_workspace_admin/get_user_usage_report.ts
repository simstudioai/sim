import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminUserUsageReportParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  REPORTS_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface UsageReportsApiResponse {
  usageReports?: unknown[]
  warnings?: unknown[]
  nextPageToken?: string
}

export const getUserUsageReportTool: ToolConfig<
  GoogleWorkspaceAdminUserUsageReportParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_user_usage_report',
  name: 'Google Workspace Admin Get User Usage Report',
  description:
    'Read per-user Google Workspace usage metrics for a single day, for one user or for every user in the account',
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
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Day the report covers, as yyyy-mm-dd. Usage is finalized some days after the date',
    },
    userKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Profile ID or email address of the user to report on. Defaults to all users in the account',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID to report on. Defaults to the authenticated account',
    },
    parameters: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Comma-separated application parameters to return (e.g. "accounts:last_login_time")',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated parameter conditions used to filter the returned users',
    },
    orgUnitID: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Report only on users in this org unit ID',
    },
    groupIdFilter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated obfuscated group IDs to filter the returned users by',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of user reports to return. Example: 100',
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
        `${REPORTS_API_BASE}/usage/users/${target}/dates/${encodeURIComponent(params.date)}`
      )
      appendQueryParams(url, {
        customerId: params.customerId,
        parameters: params.parameters,
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
    const data = await readAdminJson<UsageReportsApiResponse>(
      response,
      'Failed to get user usage report'
    )
    return {
      success: true,
      output: {
        usageReports: data.usageReports ?? [],
        warnings: data.warnings ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    usageReports: {
      type: 'json',
      description: 'Array of UsageReport resources, one per user and day',
      items: {
        type: 'json',
        properties: {
          date: { type: 'string', description: 'Day the report covers' },
          entity: {
            type: 'json',
            description: 'Entity object with customerId, userEmail, profileId, entityId, and type',
          },
          parameters: {
            type: 'json',
            description:
              'Measured parameters, each with name and one of intValue, stringValue, datetimeValue, boolValue, or msgValue',
          },
        },
      },
    },
    warnings: {
      type: 'json',
      description: 'Warnings returned with the report, each with code, message, and data',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
