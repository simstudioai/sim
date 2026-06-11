import type {
  TriggerDevExecuteQueryParams,
  TriggerDevExecuteQueryResponse,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevExecuteQueryTool: ToolConfig<
  TriggerDevExecuteQueryParams,
  TriggerDevExecuteQueryResponse
> = {
  id: 'trigger_dev_execute_query',
  name: 'Trigger.dev Execute Query',
  description:
    'Execute a TRQL (SQL-like) query against Trigger.dev run data for reporting and analytics.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'TRQL query to execute (e.g., "SELECT run_id, status, triggered_at FROM runs WHERE status = \'Failed\' LIMIT 10")',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Scope of data to query: environment (default), project, or organization',
    },
    period: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time period shorthand (e.g., "1h", "7d", "30d"). Cannot be combined with from/to',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the time range as an ISO 8601 timestamp. Must be used with "to"',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the time range as an ISO 8601 timestamp. Must be used with "from"',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Response format: "json" (default) for structured rows or "csv" for a CSV string',
    },
  },

  request: {
    url: `${TRIGGER_DEV_API_BASE}/api/v1/query`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { query: params.query }
      if (params.scope) body.scope = params.scope
      if (params.period) body.period = params.period
      if (params.from) body.from = params.from
      if (params.to) body.to = params.to
      if (params.format) body.format = params.format
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        format: data.format ?? 'json',
        results: data.results ?? [],
      },
    }
  },

  outputs: {
    format: { type: 'string', description: 'Format of the results (json or csv)' },
    results: {
      type: 'json',
      description: 'Query results: an array of row objects for json format, a CSV string for csv',
    },
  },
}
