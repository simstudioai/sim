/**
 * Salesforce webhook payload shape helpers.
 *
 * Separate from `providers/salesforce.ts` because the Salesforce *trigger*
 * definition needs this function, and the trigger registry is client-reachable.
 * The provider module imports `providers/utils`, which reaches `@sim/security`
 * and therefore `node:crypto` — Next polyfills that to `crypto-browserify`
 * (~320 KB) in the browser layer, so importing it from a trigger shipped
 * server-only signature verification to every workspace route.
 */

import { isRecordLike } from '@sim/utils/object'

export function extractSalesforceObjectTypeFromPayload(
  body: Record<string, unknown>
): string | undefined {
  const direct =
    (typeof body.objectType === 'string' && body.objectType) ||
    (typeof body.sobjectType === 'string' && body.sobjectType) ||
    undefined
  if (direct) {
    return direct
  }

  const attrs = body.attributes as Record<string, unknown> | undefined
  if (typeof attrs?.type === 'string') {
    return attrs.type
  }

  const record = body.record
  if (isRecordLike(record)) {
    const r = record as Record<string, unknown>
    if (typeof r.sobjectType === 'string') {
      return r.sobjectType
    }
    const ra = r.attributes as Record<string, unknown> | undefined
    if (typeof ra?.type === 'string') {
      return ra.type
    }
  }

  return undefined
}
