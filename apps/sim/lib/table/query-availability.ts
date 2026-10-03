import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

export const TABLE_QUERY_UNAVAILABLE_REASON =
  'The v2 table query API is not enabled for this workspace'

/** Deployment eligibility for typed predicate queries; resource authorization remains separate. */
export async function getTableQueryAvailability(actor: { userId?: string; orgId?: string | null }) {
  const enabled = await isFeatureEnabled('tables-v2-api', actor)
  return enabled ? { enabled } : { enabled, reason: TABLE_QUERY_UNAVAILABLE_REASON }
}
