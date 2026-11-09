import { recordAuditBatch } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createPersonalOrganizationTx } from '@/lib/organizations/personal'
import { enqueueOrganizationResourceCleanup } from '@/lib/organizations/resource-cleanup'
import { detachOrganizationWorkspacesTx } from '@/lib/workspaces/organization-workspaces'

/**
 * Deletes an organization in one transaction, leaving nobody without one: its workspaces detach
 * first (rather than leaning on the `ON DELETE SET NULL` foreign key, which only clears
 * `organization_id` and leaves `workspace_mode`, the payer and the storage ledger pointing at the
 * departing organization), its resource cleanup is queued, it is deleted, and each former member
 * leaves into a personal organization of their own. A detach that committed on its own would leave
 * workspaces re-billed to their owners while the organization, its members and its settings
 * survived a failed delete. Records the detach audit only after commit.
 */
export async function deleteOrganizationRehomingMembers(
  organizationId: string
): Promise<{ detachedWorkspaceIds: string[] }> {
  const { detachedWorkspaceIds, auditEntries } = await db.transaction(async (tx) => {
    const detached = await detachOrganizationWorkspacesTx(tx, organizationId)
    await enqueueOrganizationResourceCleanup(tx, organizationId)
    const formerMembers = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    await tx.delete(organization).where(eq(organization.id, organizationId))
    for (const { userId } of formerMembers) await createPersonalOrganizationTx(tx, userId)
    return detached
  })
  recordAuditBatch(auditEntries)
  return { detachedWorkspaceIds }
}
