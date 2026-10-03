import { creditsToDollars } from '@/lib/billing/credits/conversion'
import type { LogsQueryRunsParams, LogsQueryRunsResponse } from '@/tools/logs/types'
import type { InternalToolConfig } from '@/tools/types'

export const logsQueryRunsTool: InternalToolConfig<LogsQueryRunsParams, LogsQueryRunsResponse> = {
  id: 'logs_query_runs',
  name: 'Query Logs',
  description:
    'Query workflow run logs in the current workspace with the full Logs-page filter set. Returns matching run IDs.',
  version: '1.0.0',

  params: {
    workflowIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated workflow IDs to filter by',
    },
    folderIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated folder IDs to filter by (descendants included)',
    },
    level: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated statuses: 'info', 'error', 'running', 'pending', 'cancelled'. Omit for all.",
    },
    triggers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated trigger types (api, webhook, schedule, manual, chat, mcp, workflow, sim, …)',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp; only runs at or after this time',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp; only runs at or before this time',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across log fields',
    },
    costOperator: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Cost comparison operator: '=', '>', '<', '>=', '<=', '!='",
    },
    costValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cost threshold in credits, compared using costOperator',
    },
    durationOperator: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Duration comparison operator: '=', '>', '<', '>=', '<=', '!='",
    },
    durationValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration threshold in milliseconds, compared using durationOperator',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max run IDs to return (default 100, max 200)',
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
  },

  operation: {
    input: (params) => ({
      workflowIds: params.workflowIds,
      folderIds: params.folderIds,
      level: params.level === 'all' ? undefined : params.level,
      triggers: params.triggers,
      startDate: params.startDate,
      endDate: params.endDate,
      search: params.search,
      costOperator:
        params.costOperator && params.costValue !== undefined && params.costValue !== null
          ? params.costOperator
          : undefined,
      costValue:
        params.costOperator && params.costValue !== undefined && params.costValue !== null
          ? creditsToDollars(params.costValue)
          : undefined,
      durationOperator:
        params.durationOperator &&
        params.durationValue !== undefined &&
        params.durationValue !== null
          ? params.durationOperator
          : undefined,
      durationValue:
        params.durationOperator &&
        params.durationValue !== undefined &&
        params.durationValue !== null
          ? params.durationValue
          : undefined,
      limit: params.limit,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    }),
  },

  transformResponse: async (response): Promise<LogsQueryRunsResponse> => {
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result?.error || `Request failed with status ${response.status}`)
    }
    const rows: Array<{ executionId?: string | null }> = result.data || []
    return {
      success: true,
      output: {
        runIds: rows
          .map((row) => row.executionId)
          .filter((runId): runId is string => Boolean(runId)),
      },
    }
  },

  outputs: {
    runIds: {
      type: 'array',
      description: 'IDs of the runs matching the filters',
    },
  },
}
