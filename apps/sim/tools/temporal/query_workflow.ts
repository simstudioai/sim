import type {
  TemporalQueryWorkflowParams,
  TemporalQueryWorkflowResponse,
} from '@/tools/temporal/types'
import {
  decodePayloads,
  parseJsonArgs,
  parseTemporalResponse,
  stripEnumPrefix,
  type TemporalPayloads,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  workflowExecutionRef,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const queryWorkflowTool: ToolConfig<
  TemporalQueryWorkflowParams,
  TemporalQueryWorkflowResponse
> = {
  id: 'temporal_query_workflow',
  name: 'Temporal Query Workflow',
  description:
    'Run a synchronous query against the state of a Temporal workflow execution and return the result.',
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
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow ID of the execution to query',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to query (defaults to the latest run)',
    },
    queryType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the query handler to invoke (e.g., getStatus)',
    },
    queryArgs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Query arguments as JSON. A top-level array is passed as the argument list (one argument per element); any other value is passed as a single argument',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/query/${encodeURIComponent(params.queryType.trim())}`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const query: Record<string, unknown> = { queryType: params.queryType.trim() }
      const args = parseJsonArgs(params.queryArgs, 'queryArgs')
      if (args) query.queryArgs = args
      return { execution: workflowExecutionRef(params.workflowId, params.runId), query }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await parseTemporalResponse<{
      queryResult?: TemporalPayloads
      queryRejected?: { status?: string }
    }>(response, 'query workflow')

    if (data.queryRejected) {
      const status = stripEnumPrefix(data.queryRejected.status, 'WORKFLOW_EXECUTION_STATUS_')
      throw new Error(`Temporal query workflow rejected: workflow status is ${status ?? 'unknown'}`)
    }

    const decoded = decodePayloads(data.queryResult)
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
        queryType: params?.queryType ?? '',
        result: decoded.length > 1 ? decoded : (decoded[0] ?? null),
      },
    }
  },

  outputs: {
    workflowId: { type: 'string', description: 'Workflow ID of the queried execution' },
    queryType: { type: 'string', description: 'Name of the query that was run' },
    result: {
      type: 'json',
      description:
        'Decoded query result. A single payload is returned as its JSON value; multiple payloads are returned as an array',
    },
  },
}
