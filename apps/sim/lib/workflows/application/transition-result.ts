import {
  type OrchestrationErrorCode,
  throwOrchestrationFailure,
} from '@/lib/core/orchestration/types'

export function requireWorkflowTransition<
  T extends { success: boolean; error?: string; errorCode?: OrchestrationErrorCode },
>(result: T, fallbackMessage: string): asserts result is T & { success: true } {
  if (result.success) return
  throwOrchestrationFailure(result, fallbackMessage)
}
