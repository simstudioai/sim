import { db } from '@sim/db'
import { account, credential, credentialMember, workflow as workflowTable } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: 'session' | 'internal_jwt'
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
  resolvedCredentialId?: string
}

/**
 * Centralizes auth + credential membership checks for OAuth usage.
 * - Workspace-scoped credential IDs enforce active credential_member access.
 * - Legacy account IDs are resolved to workspace-scoped credentials when workflowId is provided.
 * - Direct legacy account-ID access without workflowId is restricted to account owners only.
 */
export async function authorizeCredentialUse(
  request: NextRequest,
  params: { credentialId: string; workflowId?: string; requireWorkflowIdForInternal?: boolean }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId, requireWorkflowIdForInternal = true } = params

  const auth = await checkSessionOrInternalAuth(request, {
    requireWorkflowId: requireWorkflowIdForInternal,
  })
  if (!auth.success || !auth.userId) {
    return { ok: false, error: auth.error || 'Authentication required' }
  }

  const [workflowContext] = workflowId
    ? await db
        .select({ workspaceId: workflowTable.workspaceId })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
    : [null]

  if (workflowId && (!workflowContext || !workflowContext.workspaceId)) {
    return { ok: false, error: 'Workflow not found' }
  }

  const [platformCredential] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      accountId: credential.accountId,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (platformCredential) {
    if (platformCredential.type !== 'oauth' || !platformCredential.accountId) {
      return { ok: false, error: 'Unsupported credential type for OAuth access' }
    }

    if (workflowContext && workflowContext.workspaceId !== platformCredential.workspaceId) {
      return { ok: false, error: 'Credential is not accessible from this workflow workspace' }
    }

    const [accountRow] = await db
      .select({ userId: account.userId })
      .from(account)
      .where(eq(account.id, platformCredential.accountId))
      .limit(1)

    if (!accountRow) {
      return { ok: false, error: 'Credential account not found' }
    }

    const requesterPerm =
      auth.authType === 'internal_jwt'
        ? null
        : await getUserEntityPermissions(auth.userId, 'workspace', platformCredential.workspaceId)

    if (auth.authType !== 'internal_jwt') {
      const [membership] = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, platformCredential.id),
            eq(credentialMember.userId, auth.userId),
            eq(credentialMember.status, 'active')
          )
        )
        .limit(1)

      if (!membership || requesterPerm === null) {
        return { ok: false, error: 'Unauthorized' }
      }
    }

    const ownerPerm = await getUserEntityPermissions(
      accountRow.userId,
      'workspace',
      platformCredential.workspaceId
    )
    if (ownerPerm === null) {
      return { ok: false, error: 'Unauthorized' }
    }

    return {
      ok: true,
      authType: auth.authType as CredentialAccessResult['authType'],
      requesterUserId: auth.userId,
      credentialOwnerUserId: accountRow.userId,
      workspaceId: platformCredential.workspaceId,
      resolvedCredentialId: platformCredential.accountId,
    }
  }

  if (workflowContext?.workspaceId) {
    const [workspaceCredential] = await db
      .select({
        id: credential.id,
        workspaceId: credential.workspaceId,
        accountId: credential.accountId,
      })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'oauth'),
          eq(credential.workspaceId, workflowContext.workspaceId),
          eq(credential.accountId, credentialId)
        )
      )
      .limit(1)

    if (!workspaceCredential?.accountId) {
      return { ok: false, error: 'Credential not found' }
    }

    const [accountRow] = await db
      .select({ userId: account.userId })
      .from(account)
      .where(eq(account.id, workspaceCredential.accountId))
      .limit(1)

    if (!accountRow) {
      return { ok: false, error: 'Credential account not found' }
    }

    if (auth.authType !== 'internal_jwt') {
      const [membership] = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, workspaceCredential.id),
            eq(credentialMember.userId, auth.userId),
            eq(credentialMember.status, 'active')
          )
        )
        .limit(1)

      if (!membership) {
        return { ok: false, error: 'Unauthorized' }
      }
    }

    const ownerPerm = await getUserEntityPermissions(
      accountRow.userId,
      'workspace',
      workflowContext.workspaceId
    )
    if (ownerPerm === null) {
      return { ok: false, error: 'Unauthorized' }
    }

    return {
      ok: true,
      authType: auth.authType as CredentialAccessResult['authType'],
      requesterUserId: auth.userId,
      credentialOwnerUserId: accountRow.userId,
      workspaceId: workflowContext.workspaceId,
      resolvedCredentialId: workspaceCredential.accountId,
    }
  }

  const [legacyAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, credentialId))
    .limit(1)

  if (!legacyAccount) {
    return { ok: false, error: 'Credential not found' }
  }

  if (auth.authType === 'internal_jwt') {
    return { ok: false, error: 'workflowId is required' }
  }

  if (auth.userId !== legacyAccount.userId) {
    return { ok: false, error: 'Unauthorized' }
  }

  return {
    ok: true,
    authType: auth.authType as CredentialAccessResult['authType'],
    requesterUserId: auth.userId,
    credentialOwnerUserId: legacyAccount.userId,
    resolvedCredentialId: credentialId,
  }
}
