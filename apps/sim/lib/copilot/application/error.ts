import { asOrchestrationError } from '@/lib/core/orchestration/types'

export const COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE =
  'The operation failed due to a system error. Please retry.'

/** Projects only caller-actionable application failures into Copilot-visible content. */
export function messageForCopilotApplicationError(
  error: unknown,
  fallback = COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE
): string {
  const classified = asOrchestrationError(error)
  return classified && classified.code !== 'internal' ? classified.message : fallback
}
