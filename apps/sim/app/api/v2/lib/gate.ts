import type { NextResponse } from 'next/server'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { v2Error } from '@/app/api/v2/lib/response'

/**
 * Rollout gate for the entire `/api/v2` surface.
 *
 * Exactly one check per request, placed immediately after the route
 * authenticates and before it does any work. When the flag is off the route
 * answers 404 as if it did not exist, so an ungated caller cannot distinguish
 * "not in the rollout cohort" from "no such endpoint".
 *
 * Personal keys are keyed on their authenticated user. Admitted workspace keys
 * are keyed on the workspace's billing actor and exact organization, both of
 * which came from the key's server-side workspace binding rather than caller
 * input.
 */
export async function v2ApiGateError(
  userId: string,
  organizationId?: string
): Promise<NextResponse | null> {
  if (await isFeatureEnabled('v2-api', { userId, orgId: organizationId })) return null
  return v2Error('NOT_FOUND', 'Not found')
}
