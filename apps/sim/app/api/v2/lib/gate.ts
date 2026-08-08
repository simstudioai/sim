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
 * Deliberately keyed on a server-resolved user rollout subject, never a
 * caller-supplied workspace. Personal keys use their authenticated user;
 * workspace keys use the canonical workspace billing owner as rollout-only
 * context. That billing owner is not an authorization principal.
 */
export async function v2ApiGateError(userId: string): Promise<NextResponse | null> {
  if (await isFeatureEnabled('v2-api', { userId })) return null
  return v2Error('NOT_FOUND', 'Not found')
}
