import {
  folder,
  member,
  permissions,
  project,
  projectWorkspace,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { changeProjectStoragePayersInTx } from '@/lib/billing/storage/payer-transfer'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  lockProjectBackfillWrites,
  lockProjects,
  ProjectConflictError,
  tryLockProjects,
} from '@/lib/projects/membership'
import { handoffFileCreatorsInTx } from '@/lib/uploads/contexts/workspace/creator-handoff'

/**
 * An org admin, else a teammate who administers every surviving environment. With `hold`,
 * the successor's membership or grants stay share-locked until commit, so the handoff
 * cannot land on someone demoted concurrently.
 */
export async function findProjectSuccessor(
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

/** Includes archived files and prior departures even when no environment grant remains. */
export async function listSharedResourceProjectIdsForUser(executor: DbOrTx, userId: string) {
  const rows = await executor.execute<{ projectId: string }>(sql`
    SELECT DISTINCT project_id AS "projectId" FROM (
      SELECT project_id FROM workspace_files WHERE user_id = ${userId} AND project_id IS NOT NULL
      UNION ALL SELECT project_id FROM folder WHERE user_id = ${userId} AND project_id IS NOT NULL
    ) owned ORDER BY project_id
  `)
  return rows.map((row) => row.projectId)
}

/** Validates the canonical Project owner rather than borrowing an environment's payer. */
export async function handoffProjectCreatorReferencesTx(
  tx: DbTransaction,
  record: typeof project.$inferSelect,
  departingUserId: string,
  environmentIds: string[]
) {
  const successorId = record.ownerId
  if (successorId === departingUserId)
    throw new ProjectConflictError(
      'Project resources need a successor before this account can leave'
    )
  const [successor] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, successorId))
    .for('key share')
  if (!successor) throw new ProjectConflictError('Project successor changed; retry the operation')
  const [admin] = record.organizationId
    ? await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, record.organizationId),
            eq(member.userId, successorId),
            inArray(member.role, ORG_ADMIN_ROLES)
          )
        )
        .for('share')
    : []
  if (!admin) {
    const grants = environmentIds.length
      ? await tx
          .select({ id: permissions.entityId })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.userId, successorId),
              eq(permissions.permissionType, 'admin'),
              inArray(permissions.entityId, environmentIds)
            )
          )
          .for('share')
      : []
    if (!environmentIds.length || grants.length !== environmentIds.length)
      throw new ProjectConflictError(
        'Project successor must administer every surviving environment'
      )
  }
  await handoffFileCreatorsInTx(
    tx,
    and(eq(workspaceFiles.projectId, record.id), eq(workspaceFiles.userId, departingUserId)),
    successorId
  )
  await tx
    .update(folder)
    .set({ userId: successorId })
    .where(and(eq(folder.projectId, record.id), eq(folder.userId, departingUserId)))
}

/** Partial environment departure retains attribution while Project access remains. */
export async function handoffProjectsForWorkspaceDepartureTx(
  tx: DbTransaction,
  departingUserId: string,
  workspaceIds: string[]
) {
  const ids = await lockProjectsForResourceDepartureTx(tx, workspaceIds)
  const owned = new Set(await listSharedResourceProjectIdsForUser(tx, departingUserId))
  const affectedIds = ids.filter((id) => owned.has(id))
  if (!affectedIds.length) return
  const records = await tx
    .select()
    .from(project)
    .where(inArray(project.id, affectedIds))
    .orderBy(asc(project.id))
  for (const record of records) {
    const environments = await tx
      .select({ id: workspace.id, archivedAt: workspace.archivedAt })
      .from(projectWorkspace)
      .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
      .where(eq(projectWorkspace.projectId, record.id))
    const [admin] = record.organizationId
      ? await tx
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, record.organizationId),
              eq(member.userId, departingUserId),
              inArray(member.role, ORG_ADMIN_ROLES)
            )
          )
          .for('share')
      : []
    const remainingIds = environments
      .filter((row) => !row.archivedAt && !workspaceIds.includes(row.id))
      .map((row) => row.id)
    const [grant] = remainingIds.length
      ? await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.userId, departingUserId),
              inArray(permissions.entityId, remainingIds)
            )
          )
          .for('share')
      : []
    if (admin || grant) continue
    const environmentIds = environments.map((row) => row.id)
    if (record.ownerId === departingUserId) {
      const successorId = await findProjectSuccessor(
        tx,
        record,
        departingUserId,
        environmentIds,
        true
      )
      if (!successorId)
        throw new ProjectConflictError(
          'Project resources need an administrator successor before departure'
        )
      await changeProjectStoragePayersInTx(tx, [
        {
          projectId: record.id,
          ownerId: successorId,
          organizationId: record.organizationId,
          expectedCurrentOwner: { ownerId: record.ownerId, organizationId: record.organizationId },
        },
      ])
      record.ownerId = successorId
    }
    await handoffProjectCreatorReferencesTx(tx, record, departingUserId, environmentIds)
  }
}

/** Takes Project gates before workspace payer locks; handoff may reacquire them in the same transaction. */
export async function lockProjectsForResourceDepartureTx(
  tx: DbTransaction,
  workspaceIds: string[]
) {
  await lockProjectBackfillWrites(tx, workspaceIds)
  const bindings = await tx
    .select({ projectId: projectWorkspace.projectId })
    .from(projectWorkspace)
    .where(inArray(projectWorkspace.workspaceId, workspaceIds))
  const ids = [...new Set(bindings.map((row) => row.projectId))]
  await lockProjects(tx, ids)
  return ids
}

/** Organization departure includes Project-only references left by older environment removals. */
export async function handoffProjectsForOrganizationDepartureTx(
  tx: DbTransaction,
  organizationId: string,
  departingUserId: string
) {
  const ownedIds = await listSharedResourceProjectIdsForUser(tx, departingUserId)
  if (!ownedIds.length) return
  const records = await tx
    .select()
    .from(project)
    .where(and(eq(project.organizationId, organizationId), inArray(project.id, ownedIds)))
    .orderBy(asc(project.id))
  await tryLockProjects(
    tx,
    records.map((row) => row.id)
  )
  for (const record of records) {
    const environments = await tx
      .select({ id: projectWorkspace.workspaceId })
      .from(projectWorkspace)
      .where(eq(projectWorkspace.projectId, record.id))
    const [current] = await tx.select().from(project).where(eq(project.id, record.id))
    if (!current) throw new ProjectConflictError('Project changed during departure')
    await handoffProjectCreatorReferencesTx(
      tx,
      current,
      departingUserId,
      environments.map((row) => row.id)
    )
  }
}
