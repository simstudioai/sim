import { generateId } from '@sim/utils/id'
import type {
  TemporalSignalWorkflowParams,
  TemporalSignalWorkflowResponse,
} from '@/tools/temporal/types'
import {
  parseJsonArgs,
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  workflowExecutionRef,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const signalWorkflowTool: ToolConfig<
  TemporalSignalWorkflowParams,
  TemporalSignalWorkflowResponse
> = {
  id: 'temporal_signal_workflow',
  name: 'Temporal Signal Workflow',
  description: 'Send a signal to a running Temporal workflow execution.',
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
      description: 'Workflow ID of the execution to signal',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to signal (defaults to the latest run)',
    },
    signalName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the signal handler to invoke (e.g., approve-order)',
    },
    signalInput: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Signal input as JSON. A top-level array is passed as the argument list (one argument per element); any other value is passed as a single argument',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/signal/${encodeURIComponent(params.signalName.trim())}`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {
        workflowExecution: workflowExecutionRef(params.workflowId, params.runId),
        identity: TEMPORAL_CLIENT_IDENTITY,
        requestId: generateId(),
      }
      const input = parseJsonArgs(params.signalInput, 'signalInput')
      if (input) body.input = input
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    await parseTemporalResponse(response, 'signal workflow')
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
        signalName: params?.signalName ?? '',
      },
    }
  },

  outputs: {
    workflowId: { type: 'string', description: 'Workflow ID of the signaled execution' },
    signalName: { type: 'string', description: 'Name of the signal that was sent' },
  },
}
