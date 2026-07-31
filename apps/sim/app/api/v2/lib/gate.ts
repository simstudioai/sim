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
 * Deliberately keyed on `userId` only. A workspace- or org-keyed gate would
 * have to read membership for a caller-supplied id before authorization has
 * run, and its 404-vs-403 split would then leak whether that workspace's org
 * is in the cohort — the trap the per-domain table gate has to work around by
 * running late. Keyed on the authenticated user, the check is safe to run
 * first and is uniform across every v2 route.
 */
export async function v2ApiGateError(userId: string): Promise<NextResponse | null> {
  if (await isFeatureEnabled('v2-api', { userId })) return null
  return v2Error('NOT_FOUND', 'Not found')
}
