import { db } from '@sim/db'
import { project, projectWorkspace, workspace } from '@sim/db/schema'
import { asc, eq, inArray, or } from 'drizzle-orm'
import type { ProjectStorageOwnerSnapshot } from '@/lib/billing/storage/context'
import {
  type ChangeProjectStoragePayerParams,
  changeProjectAndWorkspaceStoragePayersInTx,
} from '@/lib/billing/storage/payer-transfer'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { purgeProjectFilesInTx } from '@/lib/projects/files/purge'
import {
  lockProjectBackfillWrites,
  lockProjects,
  ProjectConflictError,
} from '@/lib/projects/membership'
import {
  findProjectSuccessor,
  handoffProjectCreatorReferencesTx,
  listSharedResourceProjectIdsForUser,
} from '@/lib/projects/resource-handoff'
import { planBilledAccountReassignmentsForUser } from '@/lib/workspaces/utils'

/** Resolve creator and environment references before loading their canonical Projects. */
async function loadRelatedProjects(executor: DbOrTx, userId: string, doomedWorkspaceIds: string[]) {
  const creatorProjectIds = await listSharedResourceProjectIdsForUser(executor, userId)
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
        creatorProjectIds.length ? inArray(project.id, creatorProjectIds) : undefined,
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

interface ProjectEnvironment {
  id: string
  archivedAt: Date | null
}

/** Every environment of `projectIds`, in one query, keyed by Project. */
async function loadProjectEnvironments(executor: DbOrTx, projectIds: string[]) {
  const rows = projectIds.length
    ? await executor
        .select({
          projectId: projectWorkspace.projectId,
          id: workspace.id,
          archivedAt: workspace.archivedAt,
        })
        .from(projectWorkspace)
        .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
        .where(inArray(projectWorkspace.projectId, projectIds))
    : []
  const byProject = new Map<string, ProjectEnvironment[]>()
  for (const { projectId, ...environment } of rows) {
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
  const records = await loadRelatedProjects(db, userId, doomedWorkspaceIds)
  const environments = await loadProjectEnvironments(
    db,
    records.map((record) => record.id)
  )
  const doomed = new Set(doomedWorkspaceIds)
  const blockers: string[] = []
  for (const record of records) {
    const decision = await planProjectDeletion(
      db,
      record,
      environments.get(record.id) ?? [],
      userId,
      doomed,
      false
    )
    if ('blocker' in decision) blockers.push(decision.blocker)
  }
  return blockers
}

/** Account teardown may erase a wholly private Project, but never strand a surviving one. */
export async function prepareProjectsForAccountDeletion(
  tx: DbTransaction,
  userId: string,
  doomedWorkspaceIds: string[]
): Promise<{ storageCleanupEventIds: string[] }> {
  const ownedEnvironments = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(or(eq(workspace.ownerId, userId), eq(workspace.billedAccountUserId, userId)))
  const affectedWorkspaceIds = [...doomedWorkspaceIds, ...ownedEnvironments.map((row) => row.id)]
  await lockProjectBackfillWrites(tx, affectedWorkspaceIds)
  const locked = new Set<string>()
  let records: (typeof project.$inferSelect)[]
  for (;;) {
    records = await loadRelatedProjects(tx, userId, affectedWorkspaceIds)
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
  const now = new Date()
  const projectChanges: ChangeProjectStoragePayerParams[] = []
  const projectRemovals: ProjectStorageOwnerSnapshot[] = []
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
      projectRemovals.push({
        projectId: record.id,
        ownerId: record.ownerId,
        organizationId: record.organizationId,
      })
      continue
    }
    if (decision.archive) {
      await tx
        .update(project)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(project.id, record.id))
    }
    if (!decision.ownerId) continue
    projectChanges.push({
      projectId: record.id,
      ownerId: decision.ownerId,
      organizationId: record.organizationId,
      expectedCurrentOwner: { ownerId: record.ownerId, organizationId: record.organizationId },
    })
  }
  const { changes: workspaceChanges } = await planBilledAccountReassignmentsForUser(userId, tx, {
    excludeWorkspaceIds: doomedWorkspaceIds,
    lockRows: true,
  })
  const { removedProjects } = await changeProjectAndWorkspaceStoragePayersInTx(tx, {
    projectChanges,
    workspaceChanges,
    projectRemovals,
  })
  if (workspaceChanges.length) {
    await tx
      .update(workspace)
      .set({ updatedAt: new Date() })
      .where(
        inArray(
          workspace.id,
          workspaceChanges.map((change) => change.workspaceId)
        )
      )
  }
  const creatorProjects = new Set(await listSharedResourceProjectIdsForUser(tx, userId))
  for (const record of records) {
    if (!creatorProjects.has(record.id)) continue
    if (projectRemovals.some((removed) => removed.projectId === record.id)) continue
    const successorId =
      projectChanges.find((change) => change.projectId === record.id)?.ownerId ?? record.ownerId
    await handoffProjectCreatorReferencesTx(
      tx,
      { ...record, ownerId: successorId },
      userId,
      (environments.get(record.id) ?? []).filter((row) => !doomed.has(row.id)).map((row) => row.id)
    )
  }
  const storageCleanupEventIds: string[] = []
  for (const { projectId: id, billableBytes } of removedProjects) {
    storageCleanupEventIds.push(...(await purgeProjectFilesInTx(tx, id, billableBytes)))
    await tx.delete(projectWorkspace).where(eq(projectWorkspace.projectId, id))
    await tx.delete(project).where(eq(project.id, id))
  }
  return { storageCleanupEventIds }
}
