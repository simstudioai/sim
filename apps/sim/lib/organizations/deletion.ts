import { recordAuditBatch } from '@sim/audit'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/identity-lock'
import type { DbTransaction } from '@/lib/db/types'
import {
  detachPersonalOrganizationWorkspacesTx,
  getPersonalOrganizationId,
} from '@/lib/organizations/personal'
import { enqueueOrganizationResourceCleanup } from '@/lib/organizations/resource-cleanup'
import { detachOrganizationWorkspacesTx } from '@/lib/workspaces/organization-workspaces'

/**
 * Deletes a team organization in one transaction: its workspaces detach first (rather than leaning
 * on the `ON DELETE SET NULL` foreign key, which only clears `organization_id` and leaves
 * `workspace_mode`, the payer and the storage ledger pointing at the departing organization), its
 * resource cleanup is queued, and it is deleted. A detach that committed on its own would leave
 * workspaces re-billed to their owners while the organization, its members and its settings
 * survived a failed delete. Records the detach audit only after commit.
 *
 * Former members are left in no organization, as an account the backfill has not reached is; each
 * gets their personal organization from `ensureViewerOrganization` the next time they open the
 * product, so the delete takes no per-member locks and stays bounded however large the team was.
 */
export async function deleteTeamOrganization(
  organizationId: string
): Promise<{ detachedWorkspaceIds: string[] }> {
  const { detachedWorkspaceIds, auditEntries } = await db.transaction(async (tx) => {
    const detached = await detachOrganizationWorkspacesTx(tx, organizationId)
    await enqueueOrganizationResourceCleanup(tx, organizationId)
    await tx.delete(organization).where(eq(organization.id, organizationId))
    return detached
  })
  recordAuditBatch(auditEntries)
  return { detachedWorkspaceIds }
}

/**
 * Deletes a departing account's personal organization in the caller's transaction, once its
 * workspaces have returned to the organization-less personal state: the organization's own files,
 * knowledge documents, chats and memory are queued for cleanup, which the account's storage sweep
 * leaves to it, and the organization goes.
 */
export async function deletePersonalOrganizationTx(
  tx: DbTransaction,
  personalOrganizationId: string
): Promise<void> {
  await enqueueOrganizationResourceCleanup(tx, personalOrganizationId)
  await tx
    .delete(organization)
    .where(and(eq(organization.id, personalOrganizationId), eq(organization.kind, 'personal')))
}

/**
 * Deletes the user's personal organization ahead of a user delete that bypasses account deletion
 * (Better Auth's admin `/admin/remove-user`), whose membership cascade would otherwise leave the
 * organization behind with no member and no payer. Its workspaces return to the organization-less
 * personal state first, as account deletion does. A no-op without a personal organization.
 */
export async function deletePersonalOrganizationOfRemovedUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const personalOrganizationId = await getPersonalOrganizationId(userId, tx)
    if (!personalOrganizationId) return
    await acquireOrganizationMutationLock(tx, personalOrganizationId)
    await detachPersonalOrganizationWorkspacesTx(tx, personalOrganizationId)
    await deletePersonalOrganizationTx(tx, personalOrganizationId)
  })
}
