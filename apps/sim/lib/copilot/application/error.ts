import { trace } from '@opentelemetry/api'
import { toError } from '@sim/utils/errors'
import { asOrchestrationError } from '@/lib/core/orchestration/types'

export const COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE =
  'The operation failed due to a system error. Please retry.'

/**
 * Projects only caller-actionable application failures into Copilot-visible
 * content. Whenever the real cause is swallowed by the generic fallback, it is
 * recorded on the active span first — otherwise these failures are
 * undiagnosable from telemetry (the cause otherwise lives only in stdout logs
 * that do not ship anywhere queryable).
 */
export function messageForCopilotApplicationError(
  error: unknown,
  fallback = COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE
): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') {
    return classified.message
  }
  trace.getActiveSpan()?.recordException(toError(error))
  return fallback
}
