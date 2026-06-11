import { generateId } from '@sim/utils/id'
import type {
  TemporalCancelWorkflowParams,
  TemporalCancelWorkflowResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  workflowExecutionRef,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const cancelWorkflowTool: ToolConfig<
  TemporalCancelWorkflowParams,
  TemporalCancelWorkflowResponse
> = {
  id: 'temporal_cancel_workflow',
  name: 'Temporal Cancel Workflow',
  description:
    'Request cooperative cancellation of a running Temporal workflow execution. The workflow decides how to respond to the request.',
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
      description: 'Workflow ID of the execution to cancel',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to cancel (defaults to the latest run)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the cancellation, recorded in the workflow history',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/cancel`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {
        workflowExecution: workflowExecutionRef(params.workflowId, params.runId),
        identity: TEMPORAL_CLIENT_IDENTITY,
        requestId: generateId(),
      }
      if (params.reason) body.reason = params.reason
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'cancel workflow')
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
      },
    }
  },

  outputs: {
    workflowId: {
      type: 'string',
      description: 'Workflow ID of the execution whose cancellation was requested',
    },
  },
}
