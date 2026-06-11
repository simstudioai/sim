import { generateId } from '@sim/utils/id'
import type {
  TemporalResetWorkflowParams,
  TemporalResetWorkflowResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  workflowExecutionRef,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const resetWorkflowTool: ToolConfig<
  TemporalResetWorkflowParams,
  TemporalResetWorkflowResponse
> = {
  id: 'temporal_reset_workflow',
  name: 'Temporal Reset Workflow',
  description:
    'Reset a Temporal workflow execution to a past workflow task, terminating the current run and replaying from the reset point in a new run.',
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
      description: 'Workflow ID of the execution to reset',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to reset (defaults to the latest run)',
    },
    workflowTaskFinishEventId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Event ID of the workflow task finish event to reset to — a WORKFLOW_TASK_COMPLETED, WORKFLOW_TASK_TIMED_OUT, WORKFLOW_TASK_FAILED, or WORKFLOW_TASK_STARTED event (find it with Get Workflow History)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the reset, recorded in the workflow history',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/reset`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const eventId = Number(params.workflowTaskFinishEventId)
      if (!Number.isFinite(eventId) || eventId <= 0) {
        throw new Error('workflowTaskFinishEventId must be a positive event ID')
      }
      const body: Record<string, unknown> = {
        workflowExecution: workflowExecutionRef(params.workflowId, params.runId),
        workflowTaskFinishEventId: eventId,
        identity: TEMPORAL_CLIENT_IDENTITY,
        requestId: generateId(),
      }
      if (params.reason) body.reason = params.reason
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await parseTemporalResponse<{ runId?: string }>(response, 'reset workflow')
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
        runId: data.runId ?? '',
      },
    }
  },

  outputs: {
    workflowId: { type: 'string', description: 'Workflow ID of the reset execution' },
    runId: { type: 'string', description: 'Run ID of the new run created by the reset' },
  },
}
