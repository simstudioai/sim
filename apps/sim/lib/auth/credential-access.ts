import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { account, workflow as workflowTable } from '@/db/schema'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: 'session' | 'api_key' | 'internal_jwt'
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
}

/**
 * Centralizes auth + collaboration rules for credential use.
 * - Uses checkHybridAuth to authenticate the caller
 * - Fetches credential owner
 * - Authorization rules:
 *   - session/api_key: allow if requester owns the credential; otherwise require workflowId and
 *     verify BOTH requester and owner have access to the workflow's workspace
 *   - internal_jwt: require workflowId (by default) and verify credential owner has access to the
 *     workflow's workspace (requester identity is the system/workflow)
 */
export async function authorizeCredentialUse(
  request: NextRequest,
  params: { credentialId: string; workflowId?: string; requireWorkflowIdForInternal?: boolean }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId, requireWorkflowIdForInternal = true } = params

  const auth = await checkHybridAuth(request, { requireWorkflowId: requireWorkflowIdForInternal })
  if (!auth.success || !auth.userId) {
    return { ok: false, error: auth.error || 'Authentication required' }
  }

  // Lookup credential owner
  const [credRow] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, credentialId))
    .limit(1)

  if (!credRow) {
    return { ok: false, error: 'Credential not found' }
  }

  const credentialOwnerUserId = credRow.userId

  // If requester owns the credential, allow immediately
  if (auth.authType !== 'internal_jwt' && auth.userId === credentialOwnerUserId) {
    return {
      ok: true,
      authType: auth.authType,
      requesterUserId: auth.userId,
      credentialOwnerUserId,
    }
  }

  // For collaboration paths, workflowId is required to scope to a workspace
  if (!workflowId) {
    return { ok: false, error: 'workflowId is required' }
  }

  const [wf] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!wf || !wf.workspaceId) {
    return { ok: false, error: 'Workflow not found' }
  }

  if (auth.authType === 'internal_jwt') {
    // Internal calls: verify credential owner belongs to the workflow's workspace
    const ownerPerm = await getUserEntityPermissions(
      credentialOwnerUserId,
      'workspace',
      wf.workspaceId
    )
    if (ownerPerm === null) {
      return { ok: false, error: 'Unauthorized' }
    }
    return {
      ok: true,
      authType: auth.authType,
      requesterUserId: auth.userId,
      credentialOwnerUserId,
      workspaceId: wf.workspaceId,
    }
  }

  // Session/API key: verify BOTH requester and owner belong to the workflow's workspace
  const requesterPerm = await getUserEntityPermissions(auth.userId, 'workspace', wf.workspaceId)
  const ownerPerm = await getUserEntityPermissions(
    credentialOwnerUserId,
    'workspace',
    wf.workspaceId
  )
  if (requesterPerm === null || ownerPerm === null) {
    return { ok: false, error: 'Unauthorized' }
  }

  return {
    ok: true,
    authType: auth.authType,
    requesterUserId: auth.userId,
    credentialOwnerUserId,
    workspaceId: wf.workspaceId,
  }
}
