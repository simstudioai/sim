import { generateId } from '@sim/utils/id'
import type {
  TemporalStartWorkflowParams,
  TemporalStartWorkflowResponse,
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

export const startWorkflowTool: ToolConfig<
  TemporalStartWorkflowParams,
  TemporalStartWorkflowResponse
> = {
  id: 'temporal_start_workflow',
  name: 'Temporal Start Workflow',
  description: 'Start a new workflow execution on a Temporal cluster.',
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
      description: 'Unique workflow ID for the new execution (e.g., order-1234)',
    },
    workflowType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Registered workflow type name to run (e.g., OrderWorkflow)',
    },
    taskQueue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task queue the workflow worker polls (e.g., orders)',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Workflow input as JSON. A top-level array is passed as the argument list (one argument per element); any other value is passed as a single argument',
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
        'Policy when a workflow with the same ID is already running: WORKFLOW_ID_CONFLICT_POLICY_FAIL, WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING, or WORKFLOW_ID_CONFLICT_POLICY_TERMINATE_EXISTING',
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
    url: (params) => temporalWorkflowUrl(params.serverUrl, params.namespace, params.workflowId),
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
      'start workflow'
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
    workflowId: { type: 'string', description: 'Workflow ID of the execution' },
    runId: { type: 'string', description: 'Run ID of the started workflow execution' },
    started: {
      type: 'boolean',
      description:
        'Whether a new execution was started (false when an existing execution was reused)',
    },
  },
}
