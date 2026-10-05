import { db } from '@sim/db'
import { member, permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  lockProject,
  lockProjectBackfillWrites,
  ProjectConflictError,
} from '@/lib/projects/membership'

/** Two indexed lookups; an `OR` around a membership subquery would scan every Project. */
async function loadRelatedProjects(executor: DbOrTx, userId: string, doomedWorkspaceIds: string[]) {
  const doomedMemberships = doomedWorkspaceIds.length
    ? await executor
        .select({ projectId: projectWorkspace.projectId })
        .from(projectWorkspace)
        .where(inArray(projectWorkspace.workspaceId, doomedWorkspaceIds))
    : []
  return executor
    .select()
    .from(project)
    .where(
      or(
        eq(project.ownerId, userId),
        doomedMemberships.length
          ? inArray(
              project.id,
              doomedMemberships.map((row) => row.projectId)
            )
          : undefined
      )
    )
    .orderBy(asc(project.id))
}

type ProjectDeletionDecision =
  | { blocker: string }
  | { remove: true }
  | { archive: boolean; ownerId?: string }

/** An org admin, else a teammate who administers every surviving environment. */
async function findProjectSuccessor(
  executor: DbOrTx,
  record: typeof project.$inferSelect,
  userId: string,
  survivorIds: string[]
): Promise<string | null> {
  if (record.organizationId) {
    const [admin] = await executor
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, record.organizationId),
          ne(member.userId, userId),
          inArray(member.role, ORG_ADMIN_ROLES)
        )
      )
      .orderBy(asc(member.userId))
      .limit(1)
    if (admin) return admin.userId
  }
  const [teammate] = await executor
    .select({ userId: permissions.userId })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.permissionType, 'admin'),
        ne(permissions.userId, userId),
        inArray(permissions.entityId, survivorIds)
      )
    )
    .groupBy(permissions.userId)
    .having(sql`count(*) = ${survivorIds.length}`)
    .orderBy(asc(permissions.userId))
    .limit(1)
  return teammate?.userId ?? null
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
  const archive = !record.archivedAt && survivors.every((row) => row.archivedAt)
  if (record.ownerId !== userId) return { archive }
  const ownerId = await findProjectSuccessor(
    executor,
    record,
    userId,
    survivors.map((row) => row.id)
  )
  return ownerId
    ? { archive, ownerId }
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
  for (const record of records) {
    const decision = await planProjectDeletion(db, record, userId, doomed)
    if ('blocker' in decision) blockers.push(decision.blocker)
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
  let records: (typeof project.$inferSelect)[]
  for (;;) {
    records = await loadRelatedProjects(tx, userId, doomedWorkspaceIds)
    const pending = records.filter((row) => !locked.has(row.id))
    if (!pending.length) break
    for (const { id } of pending) {
      await lockProject(tx, id, { lockTimeoutAlreadyBounded: locked.size > 0 })
      locked.add(id)
    }
  }
  const doomed = new Set(doomedWorkspaceIds)
  const now = new Date()
  for (const record of records) {
    const decision = await planProjectDeletion(tx, record, userId, doomed)
    if ('blocker' in decision) throw new ProjectConflictError(decision.blocker)
    if ('remove' in decision) {
      await tx.delete(projectWorkspace).where(eq(projectWorkspace.projectId, record.id))
      await tx.delete(project).where(eq(project.id, record.id))
      continue
    }
    if (!decision.archive && !decision.ownerId) continue
    await tx
      .update(project)
      .set({
        ...(decision.archive ? { archivedAt: now } : {}),
        ...(decision.ownerId ? { ownerId: decision.ownerId } : {}),
        updatedAt: now,
      })
      .where(eq(project.id, record.id))
  }
}
