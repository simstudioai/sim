import type {
  GoogleWorkspaceAdminCustomerUsageReportParams,
  GoogleWorkspaceAdminResponse,
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

export const getCustomerUsageReportTool: ToolConfig<
  GoogleWorkspaceAdminCustomerUsageReportParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_customer_usage_report',
  name: 'Google Workspace Admin Get Customer Usage Report',
  description:
    'Read account-wide Google Workspace usage metrics for a single day, such as active accounts and per-application usage',
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
        'Comma-separated application parameters to return (e.g. "accounts:num_users,gmail:num_emails_sent")',
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
      const url = new URL(`${REPORTS_API_BASE}/usage/dates/${encodeURIComponent(params.date)}`)
      appendQueryParams(url, {
        customerId: params.customerId,
        parameters: params.parameters,
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
      'Failed to get customer usage report'
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
      description: 'Array of UsageReport resources',
      items: {
        type: 'json',
        properties: {
          date: { type: 'string', description: 'Day the report covers' },
          entity: {
            type: 'json',
            description: 'Entity object with customerId, entityId, and type',
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
