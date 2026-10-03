/**
 * Typed parameter interfaces for tool executor functions.
 * Replaces Record<string, any> with specific shapes based on actual property access.
 */

export interface RunWorkflowParams {
  workflowId?: string
  workflow_input?: unknown
  input?: unknown
  /** Queue the deployed workflow and return immediately instead of waiting for its output. */
  async?: boolean
  /** Optional trigger block ID when the workflow has multiple entrypoints and the caller wants a specific one. */
  triggerBlockId?: string
  /** When true, run with the resolved trigger's generated mock payload instead of workflow_input. */
  useMockPayload?: boolean
  /** Reuse the recorded input from a past execution of this workflow instead of supplying workflow_input. */
  inputFromExecutionId?: string
  /** When true, runs the deployed version instead of the draft. Default: false (draft). */
  useDeployedState?: boolean
  /** Block outputs to return as `blockName.path` (name or id); when given, `logs` are omitted and `selected` carries only these. */
  select?: string[]
}

export interface CancelWorkflowRunParams {
  /** The workflow execution ID returned by run_workflow or query_logs. */
  executionId: string
}

export interface RunWorkflowUntilBlockParams {
  workflowId?: string
  workflow_input?: unknown
  input?: unknown
  /** Optional trigger block ID when the workflow has multiple entrypoints and the caller wants a specific one. */
  triggerBlockId?: string
  /** When true, run with the resolved trigger's generated mock payload instead of workflow_input. */
  useMockPayload?: boolean
  /** Reuse the recorded input from a past execution of this workflow instead of supplying workflow_input. */
  inputFromExecutionId?: string
  /** The block ID to stop after. Execution halts once this block completes. */
  stopAfterBlockId: string
  /** When true, runs the deployed version instead of the draft. Default: false (draft). */
  useDeployedState?: boolean
  /** Block outputs to return as `blockName.path` (name or id); when given, `logs` are omitted and `selected` carries only these. */
  select?: string[]
}

export interface RunFromBlockParams {
  workflowId?: string
  /** Mocked upstream outputs (block name/id → output object) for an isolated run. */
  variableInputs?: Record<string, unknown>
  /** The block ID to start execution from. */
  startBlockId: string
  /** Optional execution ID to load the snapshot from. If omitted, uses the latest execution. */
  executionId?: string
  workflow_input?: unknown
  input?: unknown
  useDeployedState?: boolean
  /** Block outputs to return as `blockName.path` (name or id); when given, `logs` are omitted and `selected` carries only these. */
  select?: string[]
}

export interface RunBlockParams {
  workflowId?: string
  /** Mocked upstream outputs (block name/id → output object) for an isolated run. */
  variableInputs?: Record<string, unknown>
  /** The block ID to run. Only this block executes using cached upstream outputs. */
  blockId: string
  /** Optional execution ID to load the snapshot from. If omitted, uses the latest execution. */
  executionId?: string
  workflow_input?: unknown
  input?: unknown
  useDeployedState?: boolean
  /** Block outputs to return as `blockName.path` (name or id); when given, `logs` are omitted and `selected` carries only these. */
  select?: string[]
}

export interface GenerateApiKeyParams {
  name: string
  workspaceId?: string
}
