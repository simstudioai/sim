import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { UsageWindowRangeTooLargeError } from '@/lib/billing/core/usage-analytics'

/**
 * The window resolver throws when a custom range exceeds its cap, which is a
 * caller-fixable input error rather than a fault. Without this it fell through to
 * the orchestration policy's `unhandled` branch and every over-long range answered
 * `500 Internal server error`, so the client could neither surface the real reason
 * nor tell the two apart.
 *
 * Shared by all four usage routes so they cannot classify the same throw differently.
 */
export const organizationUsageErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) =>
    error instanceof UsageWindowRangeTooLargeError
      ? internalErrorResponse(400, { error: error.message })
      : null
)
