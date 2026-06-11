import type {
  TemporalGetWorkflowHistoryParams,
  TemporalGetWorkflowHistoryResponse,
} from '@/tools/temporal/types'
import {
  mapHistoryEvent,
  parseTemporalResponse,
  type TemporalRawHistoryEvent,
  temporalRequestHeaders,
  temporalWorkflowUrl,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const getWorkflowHistoryTool: ToolConfig<
  TemporalGetWorkflowHistoryParams,
  TemporalGetWorkflowHistoryResponse
> = {
  id: 'temporal_get_workflow_history',
  name: 'Temporal Get Workflow History',
  description:
    'Fetch the event history of a Temporal workflow execution, optionally filtered to just the close event.',
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
      description: 'Workflow ID of the execution',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run (defaults to the latest run)',
    },
    maximumPageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of history events to return per page',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response, for pagination',
    },
    historyEventFilterType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Event filter: HISTORY_EVENT_FILTER_TYPE_ALL_EVENT (default) or HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT to return only the final close event',
    },
  },

  request: {
    url: (params) => {
      const search = new URLSearchParams()
      const runId = params.runId?.trim()
      if (runId) search.set('execution.runId', runId)
      const pageSize = Number(params.maximumPageSize)
      if (Number.isFinite(pageSize) && pageSize > 0) {
        search.set('maximumPageSize', String(pageSize))
      }
      if (params.nextPageToken) search.set('nextPageToken', params.nextPageToken)
      if (params.historyEventFilterType) {
        search.set('historyEventFilterType', params.historyEventFilterType)
      }
      const queryString = search.toString()
      return `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/history${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseTemporalResponse<{
      history?: { events?: TemporalRawHistoryEvent[] }
      nextPageToken?: string
    }>(response, 'get workflow history')

    return {
      success: true,
      output: {
        events: (data.history?.events ?? []).map(mapHistoryEvent),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'History events of the workflow execution, in order',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'number', description: 'Sequential ID of the event' },
          eventTime: { type: 'string', description: 'Time the event was recorded (RFC 3339)' },
          eventType: {
            type: 'string',
            description: 'Event type (e.g., WORKFLOW_EXECUTION_STARTED, ACTIVITY_TASK_COMPLETED)',
          },
          attributes: {
            type: 'json',
            description: "The event's type-specific attributes (payload data is base64-encoded)",
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of events, null when no more pages exist',
      optional: true,
    },
  },
}
