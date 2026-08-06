import type { NextResponse } from 'next/server'
import { type RateLimitResult, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Error } from '@/app/api/v2/lib/response'

type BillingWorkspaceFilter =
  | { ok: true; workspaceId: string | undefined }
  | { ok: false; response: NextResponse }

/**
 * Resolves the effective `workspaceId` ledger filter for the caller's key.
 * Personal keys may read their account-wide ledger without a filter. When any
 * key targets a workspace, the caller must have read access and the workspace's
 * API-key policy must allow the key type. Workspace-scoped keys remain pinned to
 * their own workspace.
 */
export async function v2BillingWorkspaceFilter(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string | undefined
): Promise<BillingWorkspaceFilter> {
  if (
    rateLimit.keyType === 'workspace' &&
    requestedWorkspaceId &&
    requestedWorkspaceId !== rateLimit.workspaceId
  ) {
    return {
      ok: false,
      response: v2Error('FORBIDDEN', 'API key is not authorized for this workspace'),
    }
  }

  const workspaceId =
    rateLimit.keyType === 'workspace' ? rateLimit.workspaceId : requestedWorkspaceId

  if (!workspaceId) {
    if (rateLimit.keyType === 'workspace') {
      return {
        ok: false,
        response: v2Error('FORBIDDEN', 'Workspace-scoped API key is missing its workspace'),
      }
    }
    return { ok: true, workspaceId: undefined }
  }

  const userId = rateLimit.userId
  if (!userId) {
    return {
      ok: false,
      response: v2Error('UNAUTHORIZED', 'Authentication required'),
    }
  }

  const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
  if (access) {
    return {
      ok: false,
      response: v2Error('FORBIDDEN', access.message),
    }
  }

  return { ok: true, workspaceId }
}
