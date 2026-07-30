import type { NextResponse } from 'next/server'
import type { RateLimitResult } from '@/app/api/v1/middleware'
import { v2Error } from '@/app/api/v2/lib/response'

type BillingWorkspaceFilter =
  | { ok: true; workspaceId: string | undefined }
  | { ok: false; response: NextResponse }

/**
 * Resolves the effective `workspaceId` ledger filter for the caller's key.
 * Personal keys read the account's full ledger with whatever filter they asked
 * for; a workspace-scoped key is pinned to its own workspace — the filter
 * defaults to the key's workspace and an explicit mismatch is rejected rather
 * than silently ignored.
 */
export function v2BillingWorkspaceFilter(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string | undefined
): BillingWorkspaceFilter {
  if (rateLimit.keyType !== 'workspace') {
    return { ok: true, workspaceId: requestedWorkspaceId }
  }
  if (requestedWorkspaceId && requestedWorkspaceId !== rateLimit.workspaceId) {
    return {
      ok: false,
      response: v2Error('FORBIDDEN', 'API key is not authorized for this workspace'),
    }
  }
  return { ok: true, workspaceId: rateLimit.workspaceId }
}
