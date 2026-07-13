import type { GongGetLogsParams, GongGetLogsResponse } from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const getLogsTool: ToolConfig<GongGetLogsParams, GongGetLogsResponse> = {
  id: 'gong_get_logs',
  name: 'Gong Get Logs',
  description: 'Retrieve Gong log entries of a specific type within a time range.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    logType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type of logs requested: AccessLog, UserActivityLog, UserCallPlay, ExternallySharedCallAccess, or ExternallySharedCallPlay',
    },
    fromDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Time from which to retrieve log records, in ISO-8601 format (e.g., '2024-01-01T00:00:00Z')",
    },
    toDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time until which to retrieve log records, in ISO-8601 format. Defaults to the latest available logs when omitted.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/logs')
      url.searchParams.set('logType', params.logType.trim())
      url.searchParams.set('fromDateTime', params.fromDateTime.trim())
      if (params.toDateTime?.trim()) url.searchParams.set('toDateTime', params.toDateTime.trim())
      if (params.cursor?.trim()) url.searchParams.set('cursor', params.cursor.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to get logs'))
    }
    const logEntries = (data.logEntries ?? []).map((entry: Record<string, unknown>) => ({
      userId: entry.userId ?? null,
      userEmailAddress: entry.userEmailAddress ?? null,
      userFullName: entry.userFullName ?? null,
      impersonatorUserId: entry.impersonatorUserId ?? null,
      impersonatorEmailAddress: entry.impersonatorEmailAddress ?? null,
      impersonatorFullName: entry.impersonatorFullName ?? null,
      impersonatorCompanyId: entry.impersonatorCompanyId ?? null,
      eventTime: entry.eventTime ?? null,
      logRecord: entry.logRecord ?? null,
    }))
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        logEntries,
        cursor: data.records?.cursor ?? null,
        totalRecords: data.records?.totalRecords ?? null,
        currentPageSize: data.records?.currentPageSize ?? null,
        currentPageNumber: data.records?.currentPageNumber ?? null,
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
      optional: true,
    },
    logEntries: {
      type: 'array',
      description: 'Log entries matching the requested type and time range',
      items: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: "Gong's unique numeric identifier for the user, if available",
          },
          userEmailAddress: {
            type: 'string',
            description: 'Email address of the user, if available',
          },
          userFullName: { type: 'string', description: 'Full name of the user, if available' },
          impersonatorUserId: {
            type: 'string',
            description: "Gong's unique numeric identifier for the impersonating user, if any",
          },
          impersonatorEmailAddress: {
            type: 'string',
            description: 'Email address of the impersonating user, if any',
          },
          impersonatorFullName: {
            type: 'string',
            description: 'Full name of the impersonating user, if any',
          },
          impersonatorCompanyId: {
            type: 'string',
            description: "Gong's unique numeric identifier for the impersonating user's company",
          },
          eventTime: { type: 'string', description: 'Time of the event in ISO-8601 format' },
          logRecord: {
            type: 'object',
            description: 'Log fields and associated values, populated dynamically per log type',
          },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
    totalRecords: {
      type: 'number',
      description: 'Total number of records matching the filter',
      optional: true,
    },
    currentPageSize: {
      type: 'number',
      description: 'Number of records in the current page',
      optional: true,
    },
    currentPageNumber: {
      type: 'number',
      description: 'Current page number',
      optional: true,
    },
  },
}
