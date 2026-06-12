import { generateId } from '@sim/utils/id'
import type {
  TemporalSignalWithStartParams,
  TemporalSignalWithStartResponse,
} from '@/tools/temporal/types'
import {
  parseJsonArgs,
  parseJsonPayloadMap,
  parseTemporalResponse,
  TEMPORAL_CLIENT_IDENTITY,
  temporalRequestHeaders,
  temporalWorkflowUrl,
  toDurationString,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const signalWithStartTool: ToolConfig<
  TemporalSignalWithStartParams,
  TemporalSignalWithStartResponse
> = {
  id: 'temporal_signal_with_start',
  name: 'Temporal Signal With Start',
  description:
    'Atomically signal a Temporal workflow, starting it first if it is not already running, so the signal is never lost.',
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
      description: 'Workflow ID to signal, or to start and signal (e.g., order-1234)',
    },
    workflowType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Registered workflow type name to start if the workflow is not running',
    },
    taskQueue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task queue the workflow worker polls (e.g., orders)',
    },
    signalName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the signal handler to invoke (e.g., approve-order)',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Workflow start input as JSON, used only when a new execution is started. A top-level array is passed as the argument list; any other value is passed as a single argument',
    },
    signalInput: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Signal input as JSON. A top-level array is passed as the argument list (one argument per element); any other value is passed as a single argument',
    },
    workflowIdReusePolicy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Policy for reusing a closed workflow ID: WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE, WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE_FAILED_ONLY, WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE, or WORKFLOW_ID_REUSE_POLICY_TERMINATE_IF_RUNNING',
    },
    workflowIdConflictPolicy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Policy when a workflow with the same ID is already running (defaults to using the existing run): WORKFLOW_ID_CONFLICT_POLICY_FAIL, WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING, or WORKFLOW_ID_CONFLICT_POLICY_TERMINATE_EXISTING',
    },
    cronSchedule: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cron schedule for recurring executions (e.g., "0 12 * * *")',
    },
    executionTimeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Total workflow execution timeout in seconds, including retries and continue-as-new',
    },
    runTimeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout for a single workflow run in seconds',
    },
    memo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of memo fields to attach to the execution',
    },
    searchAttributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of search attribute values to index the execution with',
    },
  },

  request: {
    url: (params) =>
      `${temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId)}/signal-with-start/${encodeURIComponent(params.signalName.trim())}`,
    method: 'POST',
    headers: (params) => temporalRequestHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {
        workflowType: { name: params.workflowType.trim() },
        taskQueue: { name: params.taskQueue.trim() },
        identity: TEMPORAL_CLIENT_IDENTITY,
        requestId: generateId(),
      }
      const input = parseJsonArgs(params.input, 'input')
      if (input) body.input = input
      const signalInput = parseJsonArgs(params.signalInput, 'signalInput')
      if (signalInput) body.signalInput = signalInput
      if (params.workflowIdReusePolicy) body.workflowIdReusePolicy = params.workflowIdReusePolicy
      if (params.workflowIdConflictPolicy) {
        body.workflowIdConflictPolicy = params.workflowIdConflictPolicy
      }
      if (params.cronSchedule) body.cronSchedule = params.cronSchedule
      const executionTimeout = toDurationString(params.executionTimeoutSeconds)
      if (executionTimeout) body.workflowExecutionTimeout = executionTimeout
      const runTimeout = toDurationString(params.runTimeoutSeconds)
      if (runTimeout) body.workflowRunTimeout = runTimeout
      const memoFields = parseJsonPayloadMap(params.memo, 'memo')
      if (memoFields) body.memo = { fields: memoFields }
      const searchAttributeFields = parseJsonPayloadMap(params.searchAttributes, 'searchAttributes')
      if (searchAttributeFields) body.searchAttributes = { indexedFields: searchAttributeFields }
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await parseTemporalResponse<{ runId?: string; started?: boolean }>(
      response,
      'signal with start'
    )
    return {
      success: true,
      output: {
        workflowId: params?.workflowId ?? '',
        runId: data.runId ?? '',
        started: data.started ?? false,
      },
    }
  },

  outputs: {
    workflowId: { type: 'string', description: 'Workflow ID of the signaled execution' },
    runId: { type: 'string', description: 'Run ID of the signaled (or newly started) execution' },
    started: {
      type: 'boolean',
      description: 'Whether this call started a new execution (false when only signaled)',
    },
  },
}
