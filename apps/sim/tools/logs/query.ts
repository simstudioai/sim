import type { LogsQueryParams, LogsQueryResponse } from '@/tools/logs/types'
import type { ToolConfig } from '@/tools/types'

export const logsQueryTool: ToolConfig<LogsQueryParams, LogsQueryResponse> = {
  id: 'logs_query',
  name: 'Query Logs',
  description: 'Query workflow execution logs in the current workspace with filters.',
  version: '1.0.0',

  params: {
    workflowIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated workflow IDs to filter by',
    },
    executionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter logs to a single execution ID',
    },
    level: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Log level filter: 'all', 'info', 'error', 'running', 'pending'. Comma-separated for multiple.",
    },
    triggers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated triggers (api, webhook, schedule, manual, chat, mothership)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max logs to return (default 100, max 200)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor returned by a previous query',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Sort field: 'date' (default), 'duration', 'cost', 'status'",
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Sort order: 'desc' (default) or 'asc'",
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp; only logs at or after this time',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp; only logs at or before this time',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across log fields',
    },
  },

  request: {
    url: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }
      const qs = new URLSearchParams({ workspaceId })
      if (params.workflowIds) qs.set('workflowIds', params.workflowIds)
      if (params.executionId) qs.set('executionId', params.executionId)
      if (params.level && params.level !== 'all') qs.set('level', params.level)
      if (params.triggers) qs.set('triggers', params.triggers)
      if (params.startDate) qs.set('startDate', params.startDate)
      if (params.endDate) qs.set('endDate', params.endDate)
      if (params.search) qs.set('search', params.search)
      if (params.cursor) qs.set('cursor', params.cursor)
      if (params.sortBy) qs.set('sortBy', params.sortBy)
      if (params.sortOrder) qs.set('sortOrder', params.sortOrder)
      if (params.limit !== undefined && params.limit !== null) {
        qs.set('limit', String(params.limit))
      }
      return `/api/logs?${qs.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<LogsQueryResponse> => {
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result?.error || `Request failed with status ${response.status}`)
    }
    return {
      success: true,
      output: {
        logs: result.data || [],
        nextCursor: result.nextCursor ?? null,
      },
    }
  },

  outputs: {
    logs: {
      type: 'array',
      description: 'Array of workflow execution log entries',
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page; null when no more results',
    },
  },
}
