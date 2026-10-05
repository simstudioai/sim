import { db } from '@sim/db'
import { member, permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { lockProject, lockProjectBackfillWrites } from '@/lib/projects/membership'

async function loadRelatedProjects(executor: DbOrTx, userId: string, doomedWorkspaceIds: string[]) {
  return executor
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
}

interface ProjectDeletionDecision {
  blocker?: string
  remove?: boolean
  ownerId?: string
}

async function planProjectDeletion(
  executor: DbOrTx,
  record: typeof project.$inferSelect,
  userId: string,
  doomed: Set<string>
): Promise<ProjectDeletionDecision> {
  const members = await executor
    .select({ id: workspace.id, archivedAt: workspace.archivedAt })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(eq(projectWorkspace.projectId, record.id))
  const survivors = members.filter((row) => !doomed.has(row.id))
  if (!survivors.length) {
    return record.organizationId || record.ownerId !== userId
      ? { blocker: 'Account deletion cannot remove another owner’s Project' }
      : { remove: true }
  }
  if (!record.archivedAt && survivors.every((row) => row.archivedAt)) {
    return {
      blocker: 'Archive the Project before deleting its last active environment with your account',
    }
  }
  if (record.ownerId !== userId) return {}
  if (record.organizationId) {
    const [successor] = await executor
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, record.organizationId),
          ne(member.userId, userId),
          inArray(member.role, ['owner', 'admin'])
        )
      )
      .orderBy(asc(member.userId))
      .limit(1)
    if (successor) return { ownerId: successor.userId }
  }
  const [successor] = await executor
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
  return successor
    ? { ownerId: successor.userId }
    : {
        blocker:
          'Give a teammate admin access to every environment before deleting the Project owner’s account',
      }
}

/** Preview uses the same lifecycle and successor rules as the locked deletion transaction. */
export async function getProjectAccountDeletionBlockers(
  userId: string,
  doomedWorkspaceIds: string[]
): Promise<string[]> {
  const records = await loadRelatedProjects(db, userId, doomedWorkspaceIds)
  const doomed = new Set(doomedWorkspaceIds)
  const blockers: string[] = []
  for (const { id } of records) {
    const [record] = await db.select().from(project).where(eq(project.id, id))
    if (!record) continue
    const decision = await planProjectDeletion(db, record, userId, doomed)
    if (decision.blocker) blockers.push(decision.blocker)
  }
  return blockers
}

/** Account teardown may erase a wholly private Project, but never strand a surviving one. */
export async function prepareProjectsForAccountDeletion(
  tx: DbTransaction,
  userId: string,
  doomedWorkspaceIds: string[]
): Promise<void> {
  const ownedEnvironments = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))
  await lockProjectBackfillWrites(tx, [
    ...doomedWorkspaceIds,
    ...ownedEnvironments.map((row) => row.id),
  ])
  const locked = new Set<string>()
  for (;;) {
    const records = await loadRelatedProjects(tx, userId, doomedWorkspaceIds)
    const pending = records.filter((row) => !locked.has(row.id))
    if (!pending.length) break
    for (const { id } of pending) {
      await lockProject(tx, id)
      locked.add(id)
    }
  }
  const records = await loadRelatedProjects(tx, userId, doomedWorkspaceIds)
  const doomed = new Set(doomedWorkspaceIds)
  for (const { id } of records) {
    await lockProject(tx, id)
    const [record] = await tx.select().from(project).where(eq(project.id, id))
    if (!record) continue
    const decision = await planProjectDeletion(tx, record, userId, doomed)
    if (decision.blocker) throw new OrchestrationError('conflict', decision.blocker)
    if (decision.remove) {
      await tx.delete(projectWorkspace).where(eq(projectWorkspace.projectId, id))
      await tx.delete(project).where(eq(project.id, id))
    }
    if (!decision.ownerId) continue
    await tx
      .update(project)
      .set({ ownerId: decision.ownerId, updatedAt: new Date() })
      .where(eq(project.id, id))
  }
}
