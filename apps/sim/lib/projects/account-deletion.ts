import { permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject, lockProjectBackfillWrites } from '@/lib/projects/membership'

/** Account teardown may erase a wholly private Project, but never strand a surviving one. */
export async function prepareProjectsForAccountDeletion(
  tx: DbTransaction,
  userId: string,
  doomedWorkspaceIds: string[]
): Promise<void> {
  await lockProjectBackfillWrites(tx)
  const records = await tx
    .select({ id: project.id })
    .from(project)
    .where(
      or(
        eq(project.ownerId, userId),
        doomedWorkspaceIds.length
          ? sql`${project.id} in (
      select ${projectWorkspace.projectId} from ${projectWorkspace}
      where ${inArray(projectWorkspace.workspaceId, doomedWorkspaceIds)}
    )`
          : undefined
      )
    )
    .orderBy(asc(project.id))
  const doomed = new Set(doomedWorkspaceIds)
  for (const { id } of records) {
    await lockProject(tx, id)
    const [record] = await tx.select().from(project).where(eq(project.id, id))
    if (!record) continue
    const members = await tx
      .select({ id: workspace.id, archivedAt: workspace.archivedAt })
      .from(projectWorkspace)
      .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
      .where(eq(projectWorkspace.projectId, id))
    const survivors = members.filter((row) => !doomed.has(row.id))
    if (!survivors.length) {
      if (record.organizationId || record.ownerId !== userId)
        throw new OrchestrationError(
          'conflict',
          'Account deletion cannot remove another owner’s Project'
        )
      await tx.delete(projectWorkspace).where(eq(projectWorkspace.projectId, id))
      await tx.delete(project).where(eq(project.id, id))
      continue
    }
    if (!record.archivedAt && survivors.every((row) => row.archivedAt))
      throw new OrchestrationError(
        'conflict',
        'Archive the Project before deleting its last active environment with your account'
      )
    if (record.ownerId !== userId) continue
    const admins = await tx
      .select({ userId: permissions.userId })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.permissionType, 'admin'),
          ne(permissions.userId, userId),
          inArray(
            permissions.entityId,
            survivors.map((row) => row.id)
          )
        )
      )
      .groupBy(permissions.userId)
      .having(sql`count(*) = ${survivors.length}`)
      .orderBy(asc(permissions.userId))
      .limit(1)
    if (!admins[0])
      throw new OrchestrationError(
        'conflict',
        'Give a teammate admin access to every environment before deleting the Project owner’s account'
      )
    await tx
      .update(project)
      .set({ ownerId: admins[0].userId, updatedAt: new Date() })
      .where(eq(project.id, id))
  }
}
