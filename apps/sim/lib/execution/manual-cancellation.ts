import { recordExecutionCancellationBackendResult } from '@/lib/core/execution-limits/metrics'

const activeExecutionAborters = new Map<string, () => void>()

export function registerManualExecutionAborter(executionId: string, abort: () => void): void {
  activeExecutionAborters.set(executionId, abort)
}

export function unregisterManualExecutionAborter(executionId: string, abort?: () => void): void {
  if (abort && activeExecutionAborters.get(executionId) !== abort) return
  activeExecutionAborters.delete(executionId)
}

export function abortManualExecution(executionId: string): boolean {
  const abort = activeExecutionAborters.get(executionId)
  if (!abort) {
    recordExecutionCancellationBackendResult({ backend: 'in_process', result: 'not_found' })
    return false
  }

  try {
    abort()
    recordExecutionCancellationBackendResult({ backend: 'in_process', result: 'cancelled' })
    return true
  } catch (error) {
    recordExecutionCancellationBackendResult({ backend: 'in_process', result: 'error' })
    throw error
  }
}
