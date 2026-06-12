import { generateId } from '@sim/utils/id'
import type {
  TemporalUpdateWorkflowParams,
  TemporalUpdateWorkflowResponse,
} from '@/tools/temporal/types'
import {
  decodePayloads,
  parseJsonArgs,
  parseTemporalResponse,
  stripEnumPrefix,
  TEMPORAL_CLIENT_IDENTITY,
  type TemporalPayloads,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  workflowExecutionRef,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const updateWorkflowTool: ToolConfig<
  TemporalUpdateWorkflowParams,
  TemporalUpdateWorkflowResponse
> = {
  id: 'temporal_update_workflow',
  name: 'Temporal Update Workflow',
  description:
    'Invoke an update handler on a running Temporal workflow and wait for its result. Unlike a signal, an update is validated by the workflow and returns a response.',
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
      description: 'Workflow ID of the execution to update',
    },
    runId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID of a specific run to update (defaults to the latest run)',
    },
    updateName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the update handler to invoke (e.g., addItem)',
    },
    updateArgs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Update arguments as JSON. A top-level array is passed as the argument list (one argument per element); any other value is passed as a single argument',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/update/${encodeURIComponent(params.updateName.trim())}`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const input: Record<string, unknown> = { name: params.updateName.trim() }
      const args = parseJsonArgs(params.updateArgs, 'updateArgs')
      if (args) input.args = args
      return {
        workflowExecution: workflowExecutionRef(params.workflowId, params.runId),
        waitPolicy: { lifecycleStage: 'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_COMPLETED' },
        request: {
          meta: { updateId: generateId(), identity: TEMPORAL_CLIENT_IDENTITY },
          input,
        },
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await parseTemporalResponse<{
      stage?: string
      outcome?: {
        success?: TemporalPayloads
        failure?: { message?: string }
      }
    }>(response, 'update workflow')

    if (data.outcome?.failure) {
      throw new Error(
        `Temporal update workflow failed: ${data.outcome.failure.message ?? 'update handler returned a failure'}`
      )
    }

    if (!data.outcome) {
      const stage = stripEnumPrefix(data.stage, 'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_')
      throw new Error(
        `Temporal update workflow did not complete before the request timed out (stage: ${stage ?? 'unknown'}). The update is still being processed by the workflow.`
      )
    }

    const decoded = decodePayloads(data.outcome?.success)
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
        updateName: params?.updateName ?? '',
        result: decoded.length > 1 ? decoded : (decoded[0] ?? null),
      },
    }
  },

  outputs: {
    workflowId: { type: 'string', description: 'Workflow ID of the updated execution' },
    updateName: { type: 'string', description: 'Name of the update that was invoked' },
    result: {
      type: 'json',
      description:
        'Decoded update result. A single payload is returned as its JSON value; multiple payloads are returned as an array',
    },
  },
}
