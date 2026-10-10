import { projectMembershipRollout, projectWorkspace, workspace } from '@sim/db/schema'
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

/** Must precede the first snapshot-producing statement in repeatable-read transactions. */
export async function lockProjectMembershipBarrier(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`LOCK TABLE ${workspace} IN ACCESS SHARE MODE`)
}

/** The barrier pins database authority through commit; never cache the phase between transactions. */
export async function getProjectMembershipPhase(
  tx: DbTransaction
): Promise<'connector' | 'column'> {
  await lockProjectMembershipBarrier(tx)
  const [state] = await tx
    .select({ phase: projectMembershipRollout.phase })
    .from(projectMembershipRollout)
    .where(eq(projectMembershipRollout.id, 'membership'))
  if (state?.phase !== 'connector' && state?.phase !== 'column') {
    throw new Error('Project membership authority is missing or invalid')
  }
  return state.phase
}

/** Caller holds the workspace barrier against connector retirement. */
async function hasLegacyMemberships(tx: DbTransaction): Promise<boolean> {
  const [legacy] = await tx.execute<{ present: boolean }>(
    sql`SELECT to_regclass('public.project_workspace') IS NOT NULL AS present`
  )
  return legacy?.present ?? false
}

/** Connector authority during overlap; column-first with null fallback after durable cutover. */
export async function getProjectEnvironmentSource(
  tx: DbTransaction
): Promise<SubqueryWithSelection<typeof fields, 'project_environments'>> {
  const phase = await getProjectMembershipPhase(tx)
  if (phase === 'connector') {
    return tx
      .select({ ...fields, projectId: projectWorkspace.projectId })
      .from(workspace)
      .leftJoin(projectWorkspace, eq(projectWorkspace.workspaceId, workspace.id))
      .as('project_environments')
  }
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
  if (
    !projectIds.length ||
    (await getProjectMembershipPhase(tx)) !== 'column' ||
    !(await hasLegacyMemberships(tx))
  )
    return
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
