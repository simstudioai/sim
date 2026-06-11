import type {
  TemporalTerminateWorkflowParams,
  TemporalTerminateWorkflowResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  workflowExecutionRef,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const terminateWorkflowTool: ToolConfig<
  TemporalTerminateWorkflowParams,
  TemporalTerminateWorkflowResponse
> = {
  id: 'temporal_terminate_workflow',
  name: 'Temporal Terminate Workflow',
  description:
    'Forcefully terminate a Temporal workflow execution immediately, without giving the workflow a chance to react.',
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
      description: 'Workflow ID of the execution to terminate',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to terminate (defaults to the latest run)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the termination, recorded in the workflow history',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/terminate`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {
        workflowExecution: workflowExecutionRef(params.workflowId, params.runId),
        identity: TEMPORAL_CLIENT_IDENTITY,
      }
      if (params.reason) body.reason = params.reason
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'terminate workflow')
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
      },
    }
  },

  outputs: {
    workflowId: { type: 'string', description: 'Workflow ID of the terminated execution' },
  },
}
