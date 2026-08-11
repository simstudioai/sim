import { db } from '@sim/db'
import { account, credential, workflow as workflowTable } from '@sim/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  type CredentialActorContext,
  canUseCredential,
  getCredentialActorContext,
  resolveCredentialTokenIdentity,
} from '@/lib/credentials/access'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: typeof AuthType.SESSION | typeof AuthType.INTERNAL_JWT
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
  resolvedCredentialId?: string
  credentialType?: 'oauth' | 'service_account'
}

const NO_CREDENTIAL_ACCESS =
  'You do not have access to this credential. Ask the credential admin to add you as a member.'
const NO_WORKSPACE_ACCESS = 'You do not have access to this workspace.'

/**
 * Maps the canonical use rule (`canUseCredential`) onto the actionable message each
 * denial deserves, so every surface authorizing a credential applies one predicate
 * and only the wording is local to this module.
 */
function credentialAccessError(access: CredentialActorContext): string | null {
  if (!access.credential) return 'Credential not found'
  if (!access.hasWorkspaceAccess) return NO_WORKSPACE_ACCESS
  if (!canUseCredential(access)) return NO_CREDENTIAL_ACCESS
  return null
}

/**
 * Centralizes auth + credential membership checks for OAuth usage.
 *
 * Every workspace-scoped credential — whether addressed by its `credential.id` or
 * by the legacy `account.id` it wraps — resolves to the same rule: active credential
 * membership, or derived credential admin. A `workflowId`, when supplied, only pins
 * which workspace a legacy account id is resolved through; it never grants access on
 * its own, so surfaces without a workflow (knowledge base connectors, credential
 * management) authorize identically to workflow surfaces.
 *
 * Raw account ids that belong to no workspace credential at all remain private to
 * their owner.
 */
export async function authorizeCredentialUse(
  request: NextRequest,
  params: {
    credentialId: string
    workflowId?: string
    requireWorkflowIdForInternal?: boolean
    callerUserId?: string
  }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId, requireWorkflowIdForInternal = true, callerUserId } = params

  const auth = await checkSessionOrInternalAuth(request, {
    requireWorkflowId: requireWorkflowIdForInternal,
  })
  if (!auth.success || !auth.userId) {
    return { ok: false, error: auth.error || 'Authentication required' }
  }

  if (
    auth.authType === AuthType.INTERNAL_JWT &&
    callerUserId !== undefined &&
    callerUserId !== auth.userId
  ) {
    return { ok: false, error: 'Caller user does not match internal token subject' }
  }

  const actingUserId = auth.userId
  const authType = auth.authType as CredentialAccessResult['authType']

  const [workflowRows, platformAccess] = await Promise.all([
    workflowId
      ? db
          .select({ workspaceId: workflowTable.workspaceId })
          .from(workflowTable)
          .where(eq(workflowTable.id, workflowId))
          .limit(1)
      : Promise.resolve([]),
    getCredentialActorContext(credentialId, actingUserId),
  ])

  const workflowContext = workflowRows[0] ?? null

  if (workflowId && !workflowContext?.workspaceId) {
    return { ok: false, error: 'Workflow not found' }
  }

  const scopeWorkspaceId = workflowContext?.workspaceId ?? null
  const platformCredential = platformAccess.credential

  if (platformCredential) {
    if (scopeWorkspaceId && scopeWorkspaceId !== platformCredential.workspaceId) {
      return { ok: false, error: 'Credential is not accessible from this workflow workspace' }
    }

    const accessError = credentialAccessError(platformAccess)
    if (accessError) return { ok: false, error: accessError }

    if (platformCredential.type === 'service_account') {
      return {
        ok: true,
        authType,
        requesterUserId: actingUserId,
        credentialOwnerUserId: actingUserId,
        workspaceId: platformCredential.workspaceId,
        resolvedCredentialId: platformCredential.id,
        credentialType: 'service_account',
      }
    }

    if (platformCredential.type !== 'oauth' || !platformCredential.accountId) {
      return { ok: false, error: 'Unsupported credential type for OAuth access' }
    }

    const identity = await resolveCredentialTokenIdentity(
      platformCredential.id,
      platformCredential.workspaceId
    )
    if (identity?.kind !== 'oauth') return { ok: false, error: 'Unauthorized' }

    return {
      ok: true,
      authType,
      requesterUserId: actingUserId,
      credentialOwnerUserId: identity.userId,
      workspaceId: platformCredential.workspaceId,
      resolvedCredentialId: platformCredential.accountId,
      credentialType: 'oauth',
    }
  }

  /**
   * Credentials predating the workspace-scoped `credential` table are addressed by
   * raw account id. Each workspace that shares the account has its own credential
   * row wrapping it, so authorization runs against the rows the caller can reach —
   * pinned to the workflow's workspace when one was supplied.
   */
  const workspaceCredentials = await db
    .select({ id: credential.id, workspaceId: credential.workspaceId })
    .from(credential)
    .where(
      and(
        eq(credential.type, 'oauth'),
        eq(credential.accountId, credentialId),
        scopeWorkspaceId ? eq(credential.workspaceId, scopeWorkspaceId) : undefined
      )
    )
    .orderBy(asc(credential.createdAt))

  let firstRejection: string | null = null
  for (const workspaceCredential of workspaceCredentials) {
    const accessError = credentialAccessError(
      await getCredentialActorContext(workspaceCredential.id, actingUserId)
    )
    if (accessError) {
      firstRejection ??= accessError
      continue
    }

    const identity = await resolveCredentialTokenIdentity(
      credentialId,
      workspaceCredential.workspaceId
    )
    if (identity?.kind !== 'oauth') {
      firstRejection ??= 'Unauthorized'
      continue
    }

    return {
      ok: true,
      authType,
      requesterUserId: actingUserId,
      credentialOwnerUserId: identity.userId,
      workspaceId: workspaceCredential.workspaceId,
      resolvedCredentialId: credentialId,
      credentialType: 'oauth',
    }
  }

  /**
   * A workflow pins the credential to that workflow's workspace, so an account that
   * resolves to no reachable credential row there is out of scope — it must not fall
   * through to the owner-only path and cross the workspace boundary.
   */
  if (scopeWorkspaceId) {
    return { ok: false, error: firstRejection ?? 'Credential not found' }
  }

  const [legacyAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, credentialId))
    .limit(1)

  if (!legacyAccount) {
    return { ok: false, error: 'Credential not found' }
  }

  if (auth.authType === AuthType.INTERNAL_JWT) {
    return { ok: false, error: 'workflowId is required' }
  }

  if (actingUserId !== legacyAccount.userId) {
    return { ok: false, error: firstRejection ?? 'Unauthorized' }
  }

  return {
    ok: true,
    authType,
    requesterUserId: actingUserId,
    credentialOwnerUserId: legacyAccount.userId,
    resolvedCredentialId: credentialId,
    credentialType: 'oauth',
  }
}
