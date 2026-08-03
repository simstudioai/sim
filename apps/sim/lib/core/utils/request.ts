import { getRequestContext } from '@sim/logger'
import { generateId } from '@sim/utils/id'
/**
 * Generate a short request ID for correlation. If called inside a request
 * context (see `withRouteHandler` and `runWithRequestContext`), returns the
 * active request's ID so inline `[${requestId}]` log prefixes align with
 * the auto-attached `{requestId=...}` logger metadata.
 */
export function generateRequestId(): string {
  return getRequestContext()?.requestId ?? generateId().slice(0, 8)
}

/**
 * No-operation function for use as default callback
 */
export const noop = () => {}
