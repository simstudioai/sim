import type {
  TemporalDescribeWorkflowParams,
  TemporalDescribeWorkflowResponse,
} from '@/tools/temporal/types'
import {
  decodePayloadMap,
  mapExecutionInfo,
  parseTemporalResponse,
  stripEnumPrefix,
  type TemporalPayload,
  type TemporalRawExecutionInfo,
  temporalRequestHeaders,
  temporalWorkflowUrl,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

interface RawDescribeResponse {
  workflowExecutionInfo?: TemporalRawExecutionInfo & {
    memo?: { fields?: Record<string, TemporalPayload> }
    searchAttributes?: { indexedFields?: Record<string, TemporalPayload> }
  }
  pendingActivities?: Array<{
    activityId?: string
    activityType?: { name?: string }
    state?: string
    attempt?: number
    lastFailure?: { message?: string }
  }>
}

export const describeWorkflowTool: ToolConfig<
  TemporalDescribeWorkflowParams,
  TemporalDescribeWorkflowResponse
> = {
  id: 'temporal_describe_workflow',
  name: 'Temporal Describe Workflow',
  description:
    'Get the current state of a Temporal workflow execution, including status, timing, memo, search attributes, and pending activities.',
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
      description: 'Workflow ID of the execution to describe',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to describe (defaults to the latest run)',
    },
  },

  request: {
    url: (params) => {
      const base = temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)
      const runId = params.runId?.trim()
      return runId ? `${base}?execution.runId=${encodeURIComponent(runId)}` : base
    },
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseTemporalResponse<RawDescribeResponse>(response, 'describe workflow')
    const info = data.workflowExecutionInfo

    return {
      success: true,
      output: {
        ...mapExecutionInfo(info),
        memo: decodePayloadMap(info?.memo?.fields),
        searchAttributes: decodePayloadMap(info?.searchAttributes?.indexedFields),
        pendingActivities: (data.pendingActivities ?? []).map((activity) => ({
          activityId: activity.activityId ?? null,
          activityType: activity.activityType?.name ?? null,
          state: stripEnumPrefix(activity.state, 'PENDING_ACTIVITY_STATE_'),
          attempt: activity.attempt ?? null,
          lastFailureMessage: activity.lastFailure?.message ?? null,
        })),
      },
    }
  },

  outputs: {
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
      optional: true,
    },
    executionTime: {
      type: 'string',
      description: 'Effective execution start time (RFC 3339), e.g. the first cron run time',
      optional: true,
    },
    historyLength: { type: 'number', description: 'Number of events in the workflow history' },
    taskQueue: { type: 'string', description: 'Task queue of the execution' },
    memo: { type: 'json', description: 'Decoded memo fields attached to the execution' },
    searchAttributes: { type: 'json', description: 'Decoded search attribute values' },
    pendingActivities: {
      type: 'array',
      description: 'Activities currently pending on the execution',
      items: {
        type: 'object',
        properties: {
          activityId: { type: 'string', description: 'Activity ID' },
          activityType: { type: 'string', description: 'Activity type name' },
          state: {
            type: 'string',
            description:
              'Pending state (SCHEDULED, STARTED, CANCEL_REQUESTED, PAUSED, or PAUSE_REQUESTED)',
          },
          attempt: { type: 'number', description: 'Current attempt number' },
          lastFailureMessage: {
            type: 'string',
            description: 'Message of the most recent failure, if the activity is retrying',
          },
        },
      },
    },
  },
}
