import { getTimeoutErrorMessage } from '@/lib/core/execution-limits'

export interface WorkflowCellResult {
  success: boolean
  status?: string
  error?: string
}

export interface WorkflowCellTerminalResult {
  status: 'completed' | 'error' | 'cancelled'
  error: string | null
}

/**
 * Preserves user cancellation as a distinct cell outcome while keeping an
 * execution-deadline abort classified as an error.
 */
export function classifyWorkflowCellTerminalResult(
  result: WorkflowCellResult,
  timeout: { timedOut: boolean; timeoutMs?: number }
): WorkflowCellTerminalResult {
  if (result.success) return { status: 'completed', error: null }

  if (result.status === 'cancelled') {
    if (timeout.timedOut) {
      return {
        status: 'error',
        error: getTimeoutErrorMessage(null, timeout.timeoutMs),
      }
    }
    return { status: 'cancelled', error: 'Cancelled' }
  }

  return {
    status: 'error',
    error: result.error ?? 'Workflow execution failed',
  }
}
