import { recordAuditBatch } from '@sim/audit'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
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
