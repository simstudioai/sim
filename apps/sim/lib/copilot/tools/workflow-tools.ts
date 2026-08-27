import type { CopilotAsyncToolStatus, CopilotToolPermissionDecision } from '@sim/db/schema'
import { isPlainRecord } from '@sim/utils/object'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
  isTerminalAsyncStatus,
  isWorkflowToolExecutionClaimable,
} from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE } from '@/lib/copilot/constants'

const WORKFLOW_TOOL_NAMES = [
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
] as const

const WORKFLOW_TOOL_NAME_SET = new Set<string>(WORKFLOW_TOOL_NAMES)

export const ASYNC_WORKFLOW_DEPLOYMENT_ERRORS = {
  missing: {
    code: 'ASYNC_WORKFLOW_DEPLOYMENT_MISSING',
    message: 'Async execution requires the workflow to be deployed first',
  },
  stale: {
    code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE',
    message: 'Async execution requires the current workflow to match its deployed version',
  },
} as const

export type AsyncWorkflowDeploymentError =
  (typeof ASYNC_WORKFLOW_DEPLOYMENT_ERRORS)[keyof typeof ASYNC_WORKFLOW_DEPLOYMENT_ERRORS]

const ASYNC_WORKFLOW_DEPLOYMENT_ERROR_BY_CODE = new Map<string, AsyncWorkflowDeploymentError>(
  Object.values(ASYNC_WORKFLOW_DEPLOYMENT_ERRORS).map((error) => [error.code, error])
)

/**
 * Why a workflow-tool execution request is not bound to the tool call it claims.
 *
 * These used to collapse into one opaque 403, which cost the caller any chance of
 * telling "someone already ran this" (benign) from "this can never run" (a real
 * defect), and told the model nothing it could act on.
 *
 * `alreadySettled` deliberately reuses `COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE`:
 * it IS the same conflict as losing the execution claim, and both client paths
 * already treat that status/code pair as benign and silent.
 */
export const COPILOT_WORKFLOW_TOOL_BINDING_ERRORS = {
  unknown: {
    code: 'COPILOT_WORKFLOW_TOOL_BINDING_UNKNOWN',
    message: 'No Copilot workflow tool call matches this execution request',
    statusCode: 404,
  },
  notWorkflowTool: {
    code: 'COPILOT_WORKFLOW_TOOL_BINDING_NOT_WORKFLOW_TOOL',
    message: 'This Copilot tool call does not run a workflow',
    statusCode: 403,
  },
  alreadySettled: {
    code: COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE,
    message: 'This Copilot workflow tool call has already completed',
    statusCode: 409,
  },
  awaitingPermission: {
    code: 'COPILOT_WORKFLOW_TOOL_BINDING_AWAITING_APPROVAL',
    message: 'This Copilot workflow tool call has not been approved yet',
    statusCode: 403,
  },
  foreignOwner: {
    code: 'COPILOT_WORKFLOW_TOOL_BINDING_FOREIGN_OWNER',
    message: 'This Copilot workflow tool call belongs to a different user',
    statusCode: 403,
  },
  workflowMismatch: {
    code: 'COPILOT_WORKFLOW_TOOL_BINDING_WORKFLOW_MISMATCH',
    message: 'This Copilot workflow tool call is bound to a different workflow',
    statusCode: 403,
  },
} as const

export type CopilotWorkflowToolBindingError =
  (typeof COPILOT_WORKFLOW_TOOL_BINDING_ERRORS)[keyof typeof COPILOT_WORKFLOW_TOOL_BINDING_ERRORS]

export type CopilotWorkflowToolBindingResult =
  | { ok: true }
  | { ok: false; rejection: CopilotWorkflowToolBindingError }

interface WorkflowToolBindingCandidate {
  toolName: string
  status: CopilotAsyncToolStatus
  permissionDecision: CopilotToolPermissionDecision | null
  args: unknown
}

/**
 * Decides whether an execution request may run under a Copilot workflow tool call.
 *
 * Non-authoritative on its own — the single-winner claim in
 * `claimWorkflowToolExecution` is what actually prevents a double run. This exists
 * so the request fails fast, and with a distinguishable reason, before spending
 * admission and billing work on something that cannot legally run.
 */
export function classifyWorkflowToolBinding(params: {
  toolCall: WorkflowToolBindingCandidate | null | undefined
  run: { userId: string; workflowId: string | null } | null | undefined
  userId: string
  workflowId: string
}): CopilotWorkflowToolBindingResult {
  const { toolCall, run, userId, workflowId } = params
  const reject = (rejection: CopilotWorkflowToolBindingError) => ({ ok: false as const, rejection })

  if (!toolCall) return reject(COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.unknown)
  if (!isWorkflowToolName(toolCall.toolName)) {
    return reject(COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.notWorkflowTool)
  }
  if (!isWorkflowToolExecutionClaimable(toolCall.status, toolCall.permissionDecision)) {
    // Split the one unclaimable bucket: a finished call is a benign duplicate,
    // an unapproved one is a real refusal.
    return reject(
      isTerminalAsyncStatus(toolCall.status)
        ? COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.alreadySettled
        : COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.awaitingPermission
    )
  }
  if (!run || run.userId !== userId) {
    return reject(COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.foreignOwner)
  }
  if (resolveWorkflowToolTargetId(toolCall.args, run.workflowId) !== workflowId) {
    return reject(COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.workflowMismatch)
  }
  return { ok: true }
}

export function isWorkflowToolName(name: string): boolean {
  return WORKFLOW_TOOL_NAME_SET.has(name)
}

/** Resolves the workflow target from immutable tool arguments, then the owning Copilot run. */
export function resolveWorkflowToolTargetId(
  args: unknown,
  runWorkflowId?: string | null
): string | undefined {
  if (isPlainRecord(args) && typeof args.workflowId === 'string' && args.workflowId.length > 0) {
    return args.workflowId
  }
  return typeof runWorkflowId === 'string' && runWorkflowId.length > 0 ? runWorkflowId : undefined
}

export function getWorkflowToolCompletionExecutionId(data: unknown): string | undefined {
  if (!isPlainRecord(data)) return undefined
  return typeof data.executionId === 'string' && data.executionId.length > 0
    ? data.executionId
    : undefined
}

/** Restores only server-defined async deployment failures from client confirmation data. */
export function getAsyncWorkflowDeploymentError(
  data: unknown
): AsyncWorkflowDeploymentError | undefined {
  if (!isPlainRecord(data) || typeof data.code !== 'string') return undefined
  return ASYNC_WORKFLOW_DEPLOYMENT_ERROR_BY_CODE.get(data.code)
}

export function getWorkflowToolCompletionMessage(status: AsyncConfirmationStatus): string {
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.success) {
    return 'Workflow execution completed.'
  }
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled) {
    return 'Workflow execution was cancelled.'
  }
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
    return 'Workflow execution is continuing in the background.'
  }
  return 'Workflow execution failed.'
}

export function getWorkflowToolConfirmationStatus(
  status: 'completed' | 'failed' | 'cancelled'
): AsyncConfirmationStatus {
  if (status === 'completed') return ASYNC_TOOL_CONFIRMATION_STATUS.success
  if (status === 'cancelled') return ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
  return ASYNC_TOOL_CONFIRMATION_STATUS.error
}

export function createStructuralWorkflowToolCompletionData(
  status: AsyncConfirmationStatus,
  workflowId?: string,
  executionId?: string,
  deploymentError?: AsyncWorkflowDeploymentError
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.success) data.success = true
  if (
    status === ASYNC_TOOL_CONFIRMATION_STATUS.error ||
    status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
  ) {
    data.success = false
  }
  if (workflowId) data.workflowId = workflowId
  if (executionId) data.executionId = executionId
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.error && deploymentError) {
    data.code = deploymentError.code
    data.error = deploymentError.message
  }
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled) {
    data.reason = 'user_cancelled'
    data.cancelledByUser = true
  }
  return data
}
