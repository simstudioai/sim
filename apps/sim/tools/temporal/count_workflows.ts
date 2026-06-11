import type {
  TemporalCountWorkflowsParams,
  TemporalCountWorkflowsResponse,
} from '@/tools/temporal/types'
import {
  decodePayload,
  parseTemporalResponse,
  type TemporalPayload,
  temporalNamespaceUrl,
  temporalRequestHeaders,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const countWorkflowsTool: ToolConfig<
  TemporalCountWorkflowsParams,
  TemporalCountWorkflowsResponse
> = {
  id: 'temporal_count_workflows',
  name: 'Temporal Count Workflows',
  description:
    'Count workflow executions in a Temporal namespace matching a visibility query, with optional GROUP BY aggregation.',
  version: '1.0.0',

  params: {
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: "Base URL of the Temporal server's HTTP API (e.g., http://localhost:7243)",
    },
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Temporal namespace (e.g., default)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key sent as a Bearer token (leave blank for servers without auth)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Visibility count filter, e.g. ExecutionStatus = "Running" or ... GROUP BY ExecutionStatus (empty counts all executions)',
    },
  },

  request: {
    url: (params) => {
      const base = `${temporalNamespaceUrl(params.serverUrl, params.namespace)}/workflow-count`
      return params.query ? `${base}?query=${encodeURIComponent(params.query)}` : base
    },
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseTemporalResponse<{
      count?: string
      groups?: Array<{ groupValues?: TemporalPayload[]; count?: string }>
    }>(response, 'count workflows')

    return {
      success: true,
      output: {
        count: data.count != null ? Number(data.count) : 0,
        groups: (data.groups ?? []).map((group) => ({
          values: (group.groupValues ?? []).map(decodePayload),
          count: group.count != null ? Number(group.count) : 0,
        })),
      },
    }
  },

  outputs: {
    count: { type: 'number', description: 'Number of workflow executions matching the query' },
    groups: {
      type: 'array',
      description: 'Per-group counts when the query uses GROUP BY (empty otherwise)',
      items: {
        type: 'object',
        properties: {
          values: { type: 'json', description: 'Decoded values of the GROUP BY fields' },
          count: { type: 'number', description: 'Number of executions in the group' },
        },
      },
    },
  },
}
