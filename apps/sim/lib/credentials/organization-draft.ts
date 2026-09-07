import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { account, credential, credentialMember, pendingCredentialDraft } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { deleteOrphanedOAuthAccount } from '@/lib/credentials/deletion'
import { getCredentialCreationOrganizationContext } from '@/lib/credentials/organization'
import { clearOAuthRefreshDeadFlag } from '@/lib/oauth/refresh-coordination'

/** Completes the exact draft bound to the authenticated provider callback, rechecking current ownership under membership locks. */
export async function completeOrganizationCredentialDraft(input: {
  draftId: string
  organizationId: string
  userId: string
  providerId: string
  accountId: string
}): Promise<void> {
  const now = new Date()
  const result = await db.transaction(async (tx) => {
    await acquireOrganizationUserMutationLocks(tx, {
      userId: input.userId,
      organizationIds: [input.organizationId],
    })
    const context = await getCredentialCreationOrganizationContext({
      ...input,
      executor: tx,
      forUpdate: true,
    })
    if (!context?.canWrite)
      throw new OrchestrationError('forbidden', 'Organization administrator access is required')
    const scope = { kind: 'organization' as const, organizationId: input.organizationId }
    const [draft] = await tx
      .select()
      .from(pendingCredentialDraft)
      .where(
        and(
          eq(pendingCredentialDraft.id, input.draftId),
          eq(pendingCredentialDraft.userId, input.userId),
          eq(pendingCredentialDraft.providerId, input.providerId),
          resourceScopeCondition(pendingCredentialDraft, scope),
          gt(pendingCredentialDraft.expiresAt, now)
        )
      )
      .for('update')
      .limit(1)
    if (!draft)
      throw new OrchestrationError('not_found', 'OAuth connection link is invalid or expired')
    const [linkedAccount] = await tx
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.id, input.accountId),
          eq(account.userId, input.userId),
          eq(account.providerId, input.providerId)
        )
      )
      .limit(1)
    if (!linkedAccount)
      throw new OrchestrationError(
        'forbidden',
        'OAuth account does not belong to the connecting user'
      )
    const [existing] = await tx
      .select()
      .from(credential)
      .where(
        and(
          resourceScopeCondition(credential, scope),
          eq(credential.type, 'oauth'),
          draft.credentialId
            ? eq(credential.id, draft.credentialId)
            : eq(credential.accountId, input.accountId)
        )
      )
      .limit(1)
    if (
      draft.credentialId &&
      (!existing || existing.createdBy !== input.userId || existing.providerId !== input.providerId)
    ) {
      throw new OrchestrationError('not_found', 'OAuth credential not found')
    }
    const credentialId = existing?.id ?? generateId()
    if (existing) {
      await tx
        .update(credential)
        .set({ accountId: input.accountId, updatedAt: now })
        .where(eq(credential.id, existing.id))
    } else {
      await tx.insert(credential).values({
        id: credentialId,
        organizationId: input.organizationId,
        workspaceId: null,
        type: 'oauth',
        displayName: draft.displayName,
        description: draft.description,
        providerId: input.providerId,
        accountId: input.accountId,
        createdBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(credentialMember).values({
        id: generateId(),
        credentialId,
        userId: input.userId,
        role: 'admin',
        status: 'active',
        joinedAt: now,
        invitedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
    }
    await tx.delete(pendingCredentialDraft).where(eq(pendingCredentialDraft.id, draft.id))
    return {
      credentialId,
      displayName: existing?.displayName ?? draft.displayName,
      reconnected: Boolean(existing),
      oldAccountId: existing?.accountId,
    }
  })
  await clearOAuthRefreshDeadFlag(input.accountId)
  recordAudit({
    actorId: input.userId,
    action: result.reconnected
      ? AuditAction.CREDENTIAL_RECONNECTED
      : AuditAction.CREDENTIAL_CREATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: result.credentialId,
    resourceName: result.displayName,
    description: `${result.reconnected ? 'Reconnected' : 'Created'} OAuth credential "${result.displayName}"`,
    metadata: {
      organizationId: input.organizationId,
      providerId: input.providerId,
      accountId: input.accountId,
    },
  })
  if (result.oldAccountId && result.oldAccountId !== input.accountId)
    await deleteOrphanedOAuthAccount(result.oldAccountId)
}
