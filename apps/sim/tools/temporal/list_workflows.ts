import type {
  TemporalListWorkflowsParams,
  TemporalListWorkflowsResponse,
} from '@/tools/temporal/types'
import {
  mapExecutionInfo,
  parseTemporalResponse,
  type TemporalRawExecutionInfo,
  temporalNamespaceUrl,
  temporalRequestHeaders,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const listWorkflowsTool: ToolConfig<
  TemporalListWorkflowsParams,
  TemporalListWorkflowsResponse
> = {
  id: 'temporal_list_workflows',
  name: 'Temporal List Workflows',
  description:
    'List workflow executions in a Temporal namespace, optionally filtered with a visibility query.',
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
        'Visibility list filter, e.g. WorkflowType = "OrderWorkflow" AND ExecutionStatus = "Running" (empty lists all executions)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of executions to return per page',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response, for pagination',
    },
  },

  request: {
    url: (params) => {
      const search = new URLSearchParams()
      if (params.query) search.set('query', params.query)
      const pageSize = Number(params.pageSize)
      if (Number.isFinite(pageSize) && pageSize > 0) search.set('pageSize', String(pageSize))
      if (params.nextPageToken) search.set('nextPageToken', params.nextPageToken)
      const queryString = search.toString()
      return `${temporalNamespaceUrl(params.serverUrl, params.namespace)}/workflows${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseTemporalResponse<{
      executions?: TemporalRawExecutionInfo[]
      nextPageToken?: string
    }>(response, 'list workflows')

    return {
      success: true,
      output: {
        executions: (data.executions ?? []).map(mapExecutionInfo),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    executions: {
      type: 'array',
      description: 'Workflow executions matching the query',
      items: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'Workflow ID of the execution' },
          runId: { type: 'string', description: 'Run ID of the execution' },
          workflowType: { type: 'string', description: 'Workflow type name' },
          status: {
            type: 'string',
            description:
              'Execution status (RUNNING, COMPLETED, FAILED, CANCELED, TERMINATED, CONTINUED_AS_NEW, or TIMED_OUT)',
          },
          startTime: { type: 'string', description: 'Start time of the execution (RFC 3339)' },
          closeTime: {
            type: 'string',
            description: 'Close time of the execution (RFC 3339), null while running',
          },
          executionTime: {
            type: 'string',
            description: 'Effective execution start time (RFC 3339)',
          },
          historyLength: {
            type: 'number',
            description: 'Number of events in the workflow history',
          },
          taskQueue: { type: 'string', description: 'Task queue of the execution' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results, null when no more pages exist',
      optional: true,
    },
  },
}
