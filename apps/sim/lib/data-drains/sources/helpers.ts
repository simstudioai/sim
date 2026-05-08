import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Returns the IDs of all workspaces belonging to the organization. Used by
 * sources whose underlying tables are workspace-scoped rather than org-scoped.
 */
export async function getOrganizationWorkspaceIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.organizationId, organizationId))
  return rows.map((row) => row.id)
}
