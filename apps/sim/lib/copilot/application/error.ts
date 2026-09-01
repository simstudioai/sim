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
  trace.getActiveSpan()?.recordException(flattenErrorChain(error))
  return fallback
}

/**
 * Wrapper errors (Drizzle's "Failed query: <sql>") bury the actionable cause —
 * the Postgres constraint/violation — in `cause`. Join the chain so the span
 * exception carries the part an investigator actually needs.
 */
function flattenErrorChain(error: unknown): Error {
  const primary = toError(error)
  const parts = [primary.message]
  let cursor: unknown = primary.cause
  let depth = 0
  while (cursor && depth < 4) {
    parts.push(toError(cursor).message)
    cursor = toError(cursor).cause
    depth += 1
  }
  if (parts.length === 1) return primary
  const flattened = new Error(parts.join(' ← '))
  flattened.stack = primary.stack
  return flattened
}
