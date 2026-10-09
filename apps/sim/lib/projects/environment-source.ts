import { projectWorkspace, workspace } from '@sim/db/schema'
import { and, eq, exists, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { SubqueryWithSelection } from 'drizzle-orm/pg-core'
import type { DbTransaction } from '@/lib/db/types'

const fields = {
  id: workspace.id,
  projectId: workspace.projectId,
  name: workspace.name,
  ownerId: workspace.ownerId,
  organizationId: workspace.organizationId,
  archivedAt: workspace.archivedAt,
  parentId: workspace.forkedFromWorkspaceId,
}

/**
 * Columns win over legacy assignments. The workspace table lock protects the catalog
 * check and fallback read from connector retirement until the caller commits. It is
 * compatible with ordinary writes; retirement locks workspace and both FK-related
 * tables up front with NOWAIT before dropping the connector.
 */
async function hasLegacyMemberships(tx: DbTransaction): Promise<boolean> {
  await tx.execute(sql`LOCK TABLE ${workspace} IN ACCESS SHARE MODE`)
  const [legacy] = await tx.execute<{ present: boolean }>(
    sql`SELECT to_regclass('public.project_workspace') IS NOT NULL AS present`
  )
  return legacy?.present ?? false
}

/** Every workspace appears once; a populated column supersedes its legacy assignment. */
export async function getProjectEnvironmentSource(
  tx: DbTransaction
): Promise<SubqueryWithSelection<typeof fields, 'project_environments'>> {
  if (!(await hasLegacyMemberships(tx)))
    return tx.select(fields).from(workspace).as('project_environments')
  return tx
    .select(fields)
    .from(workspace)
    .where(isNotNull(workspace.projectId))
    .unionAll(
      tx
        .select({ ...fields, projectId: projectWorkspace.projectId })
        .from(workspace)
        .leftJoin(projectWorkspace, eq(projectWorkspace.workspaceId, workspace.id))
        .where(isNull(workspace.projectId))
    )
    .as('project_environments')
}

/**
 * A detached environment can still have a legacy reference to a Project being deleted.
 * Remove only references superseded by a different non-null column, under the caller's
 * Project locks and deletion transaction. Current memberships remain protected by the FK.
 */
export async function deleteObsoleteProjectMemberships(
  tx: DbTransaction,
  projectIds: string[]
): Promise<void> {
  if (!projectIds.length || !(await hasLegacyMemberships(tx))) return
  await tx.delete(projectWorkspace).where(
    and(
      inArray(projectWorkspace.projectId, projectIds),
      exists(
        tx
          .select({ id: workspace.id })
          .from(workspace)
          .where(
            and(
              eq(workspace.id, projectWorkspace.workspaceId),
              isNotNull(workspace.projectId),
              ne(workspace.projectId, projectWorkspace.projectId)
            )
          )
      )
    )
  )
}
