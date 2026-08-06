import { isPlainRecord } from '@sim/utils/object'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'

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
