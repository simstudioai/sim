import type { ClockifyReportWeeklyParams, ClockifyReportWeeklyResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyReportWeeklyTool: ToolConfig<
  ClockifyReportWeeklyParams,
  ClockifyReportWeeklyResponse
> = {
  id: 'clockify_report_weekly',
  name: 'Clockify Weekly Report',
  description: 'Generate a weekly time report for a workspace with optional user and project filters',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Clockify API key',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace ID to generate the report for',
    },
    dateRangeStart: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in ISO8601 format (e.g., "2024-01-01T00:00:00Z")',
    },
    dateRangeEnd: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in ISO8601 format (e.g., "2024-01-31T23:59:59Z")',
    },
    userIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of user IDs to filter by',
    },
    projectIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of project IDs to filter by',
    },
  },

  request: {
    url: (params) =>
      `https://reports.api.clockify.me/v1/workspaces/${params.workspaceId}/reports/weekly`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-Api-Key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        dateRangeStart: params.dateRangeStart,
        dateRangeEnd: params.dateRangeEnd,
      }
      if (params.userIds) {
        const ids = params.userIds
          .split(',')
          .map((id: string) => id.trim())
          .filter(Boolean)
        if (ids.length > 0) {
          body.users = { ids, contains: 'CONTAINS', status: 'ALL' }
        }
      }
      if (params.projectIds) {
        const ids = params.projectIds
          .split(',')
          .map((id: string) => id.trim())
          .filter(Boolean)
        if (ids.length > 0) {
          body.projects = { ids, contains: 'CONTAINS', status: 'ALL' }
        }
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to generate report')
    }

    return {
      success: true,
      output: {
        weeks: data.groupOne || [],
        totals: data.totals?.[0] || {},
      },
    }
  },

  outputs: {
    weeks: {
      type: 'json',
      description: 'Weekly report groups',
    },
    totals: {
      type: 'json',
      description: 'Weekly report totals',
    },
  },
}
