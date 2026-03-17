const activeExecutionAborters = new Map<string, () => void>()

export function registerManualExecutionAborter(executionId: string, abort: () => void): void {
  activeExecutionAborters.set(executionId, abort)
}

export function unregisterManualExecutionAborter(executionId: string): void {
  activeExecutionAborters.delete(executionId)
}

export function abortManualExecution(executionId: string): boolean {
  const abort = activeExecutionAborters.get(executionId)
  if (!abort) {
    return false
  }

  abort()
  return true
}
