import { db } from '@sim/db'
import { member, permissions, project, workspace } from '@sim/db/schema'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  deleteObsoleteProjectMemberships,
  getProjectEnvironmentSource,
} from '@/lib/projects/environment-source'
import { ProjectConflictError } from '@/lib/projects/errors'
import { lockProjectBackfillWrites, lockProjects } from '@/lib/projects/membership'

/** Two indexed lookups; an `OR` around a membership subquery would scan every Project. */
async function loadRelatedProjects(
  executor: DbTransaction,
  userId: string,
  doomedWorkspaceIds: string[]
) {
  const environments = await getProjectEnvironmentSource(executor)
  const doomedMemberships = doomedWorkspaceIds.length
    ? await executor
        .select({ projectId: environments.projectId })
        .from(environments)
        .where(inArray(environments.id, doomedWorkspaceIds))
    : []
  const projectIds = doomedMemberships.flatMap((row) => (row.projectId ? [row.projectId] : []))
  return executor
    .select()
    .from(project)
    .where(
      or(
        eq(project.ownerId, userId),
        projectIds.length ? inArray(project.id, projectIds) : undefined
      )
    )
    .orderBy(asc(project.id))
}

type ProjectDeletionDecision =
  | { blocker: string }
  | { remove: true }
  | { archive: boolean; ownerId?: string }

/**
 * An org admin, else a teammate who administers every surviving environment. With `hold`,
 * the successor's membership or grants stay share-locked until commit, so the handoff
 * cannot land on someone demoted concurrently.
 */
async function findProjectSuccessor(
  executor: DbOrTx,
  record: typeof project.$inferSelect,
  userId: string,
  survivorIds: string[],
  hold: boolean
): Promise<string | null> {
  if (record.organizationId) {
    const adminQuery = executor
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
    const [admin] = await (hold ? adminQuery.for('share') : adminQuery)
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
  if (!teammate || !hold) return teammate?.userId ?? null
  const held = await executor
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.permissionType, 'admin'),
        eq(permissions.userId, teammate.userId),
        inArray(permissions.entityId, survivorIds)
      )
    )
    .for('share')
  return held.length === survivorIds.length ? teammate.userId : null
}

interface ProjectEnvironment {
  id: string
  archivedAt: Date | null
}

/** Every environment of `projectIds`, in one query, keyed by Project. */
async function loadProjectEnvironments(executor: DbTransaction, projectIds: string[]) {
  const environments = await getProjectEnvironmentSource(executor)
  const rows = projectIds.length
    ? await executor
        .select({
          projectId: environments.projectId,
          id: environments.id,
          archivedAt: environments.archivedAt,
        })
        .from(environments)
        .where(inArray(environments.projectId, projectIds))
    : []
  const byProject = new Map<string, ProjectEnvironment[]>()
  for (const { projectId, ...environment } of rows) {
    if (!projectId) continue
    const environments = byProject.get(projectId)
    if (environments) environments.push(environment)
    else byProject.set(projectId, [environment])
  }
  return byProject
}

async function planProjectDeletion(
  executor: DbOrTx,
  record: typeof project.$inferSelect,
  members: ProjectEnvironment[],
  userId: string,
  doomed: Set<string>,
  hold: boolean
): Promise<ProjectDeletionDecision> {
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
    survivors.map((row) => row.id),
    hold
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
  return db.transaction(async (tx) => {
    const records = await loadRelatedProjects(tx, userId, doomedWorkspaceIds)
    const environments = await loadProjectEnvironments(
      tx,
      records.map((record) => record.id)
    )
    const doomed = new Set(doomedWorkspaceIds)
    const blockers: string[] = []
    for (const record of records) {
      const decision = await planProjectDeletion(
        tx,
        record,
        environments.get(record.id) ?? [],
        userId,
        doomed,
        false
      )
      if ('blocker' in decision) blockers.push(decision.blocker)
    }
    return blockers
  })
}

/** Transfers surviving Projects and returns private Projects to delete after their workspaces. */
export async function prepareProjectsForAccountDeletion(
  tx: DbTransaction,
  userId: string,
  doomedWorkspaceIds: string[]
): Promise<string[]> {
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
    await lockProjects(
      tx,
      pending.map((row) => row.id)
    )
    for (const { id } of pending) locked.add(id)
  }
  const environments = await loadProjectEnvironments(
    tx,
    records.map((record) => record.id)
  )
  const doomed = new Set(doomedWorkspaceIds)
  const projectsToDelete: string[] = []
  const now = new Date()
  for (const record of records) {
    const decision = await planProjectDeletion(
      tx,
      record,
      environments.get(record.id) ?? [],
      userId,
      doomed,
      true
    )
    if ('blocker' in decision) throw new ProjectConflictError(decision.blocker)
    if ('remove' in decision) {
      projectsToDelete.push(record.id)
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
  await deleteObsoleteProjectMemberships(tx, projectsToDelete)
  return projectsToDelete
}
