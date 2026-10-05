import { permissionGroup, project, projectWorkspace, workspace } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncateAtCodePoint } from '@sim/utils/string'
import { and, asc, eq, inArray, isNull, notInArray, type SQL, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquireAdvisoryXactLock, tryAcquireAdvisoryXactLocks } from '@/lib/db/advisory-locks'
import { textArrayLiteral } from '@/lib/db/arrays'
import type { DbTransaction } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'

const PROJECT_LOCK_TIMEOUT_MS = 5_000

/** A Project lifecycle rule or lock refused the change; callers may map it to their own error. */
export class ProjectConflictError extends OrchestrationError {
  constructor(message: string) {
    super('conflict', message)
    this.name = 'ProjectConflictError'
  }
}

async function boundProjectLockTimeout(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`SELECT set_config('lock_timeout', ${`${PROJECT_LOCK_TIMEOUT_MS}ms`}, true)`)
}

/** Shared per-environment gate keeps membership absence reads stable during SQL backfill. */
export async function lockProjectBackfillWrites(
  tx: DbTransaction,
  workspaceIds: string[]
): Promise<void> {
  if (!workspaceIds.length) return
  await boundProjectLockTimeout(tx)
  try {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:' || id, 0))
      FROM (SELECT DISTINCT unnest(${textArrayLiteral(workspaceIds)}) AS id ORDER BY id) ids
    `)
  } catch (error) {
    if (getPostgresErrorCode(error) === '55P03')
      throw new ProjectConflictError('Project backfill is running; retry the operation')
    throw error
  }
}

/**
 * Canonical Project mutex; membership and lifecycle writers hold it until commit.
 * `lockTimeoutAlreadyBounded` skips the bound a Project lock taken earlier in the
 * transaction already set.
 */
export async function lockProject(
  tx: DbTransaction,
  projectId: string,
  options?: { lockTimeoutAlreadyBounded?: boolean }
): Promise<void> {
  if (!options?.lockTimeoutAlreadyBounded) await boundProjectLockTimeout(tx)
  try {
    await acquireAdvisoryXactLock(tx, 'project', `project:${projectId}`)
  } catch (error) {
    if (getPostgresErrorCode(error) === '55P03')
      throw new ProjectConflictError('Project is changing; retry the operation')
    throw error
  }
}

function generatedProjectName(workspaceName: string): string {
  const suffix = ' - Project'
  return `${truncateAtCodePoint(workspaceName.trim() || 'Untitled', 100 - suffix.length, '')}${suffix}`
}

/** Selects `workspaceId` and every fork descendant, archived ones included, as `descendants`. */
function forkSubtree(workspaceId: string): SQL {
  return sql`
    WITH RECURSIVE descendants AS (
      SELECT id, name, owner_id, archived_at FROM workspace WHERE id = ${workspaceId}
      UNION
      SELECT w.id, w.name, w.owner_id, w.archived_at
      FROM workspace w JOIN descendants d ON w.forked_from_workspace_id = d.id
    )`
}

export async function createProjectForWorkspace(
  tx: DbTransaction,
  input: {
    workspaceId: string
    name: string
    organizationId: string | null
    ownerId: string
    archivedAt?: Date | null
    projectName?: string
  }
): Promise<string> {
  const id = generateId()
  await tx.insert(project).values({
    id,
    name: input.projectName ?? generatedProjectName(input.name),
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    archivedAt: input.archivedAt ?? null,
  })
  await tx.insert(projectWorkspace).values({ projectId: id, workspaceId: input.workspaceId })
  return id
}

/** Returns null only for a legacy workspace awaiting the SQL backfill. */
export async function lockWorkspaceProject(tx: DbTransaction, workspaceId: string) {
  await lockProjectBackfillWrites(tx, [workspaceId])
  const [membership] = await tx
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
    .limit(1)
  if (!membership) return null
  await lockProject(tx, membership.projectId, { lockTimeoutAlreadyBounded: true })
  const [current] = await tx
    .select({ project })
    .from(projectWorkspace)
    .innerJoin(project, eq(project.id, projectWorkspace.projectId))
    .where(eq(projectWorkspace.workspaceId, workspaceId))
    .limit(1)
  if (!current || current.project.id !== membership.projectId) {
    throw new ProjectConflictError('Project membership changed; retry the operation')
  }
  return current.project
}

/**
 * Locks the parent's Project for a new fork; null means a legacy parent awaiting
 * backfill whose subtree must still be unassigned. Refuses an archived Project.
 */
export async function requireForkProject(tx: DbTransaction, parentWorkspaceId: string) {
  const parent = await lockWorkspaceProject(tx, parentWorkspaceId)
  if (!parent) {
    await requireUnassignedForkSubtree(tx, parentWorkspaceId)
    return null
  }
  if (parent.archivedAt) throw new ProjectConflictError('Cannot fork an archived Project')
  return parent
}

/** Legacy fallback must not hide partially assigned descendants. Caller holds the lineage lock. */
async function requireUnassignedForkSubtree(tx: DbTransaction, workspaceId: string): Promise<void> {
  const descendants = await tx.execute<{ id: string }>(
    sql`${forkSubtree(workspaceId)} SELECT id FROM descendants`
  )
  if (!descendants.length) return
  await lockProjectBackfillWrites(
    tx,
    descendants.map((row) => row.id)
  )
  const rows = await tx
    .select({ id: projectWorkspace.workspaceId })
    .from(projectWorkspace)
    .where(
      inArray(
        projectWorkspace.workspaceId,
        descendants.map((row) => row.id)
      )
    )
    .limit(1)
  if (rows.length)
    throw new ProjectConflictError('Fork descendants need Project membership reconciliation')
}

/**
 * Keeps an active Project from outliving its environments: archiving its last active
 * environment archives it too. Returns whether it did. Caller holds the Project lock.
 */
export async function archiveProjectWithLastEnvironment(
  tx: DbTransaction,
  projectId: string,
  workspaceId: string,
  now: Date
): Promise<boolean> {
  const archived = await tx
    .update(project)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(project.id, projectId),
        isNull(project.archivedAt),
        sql`NOT EXISTS (
          SELECT 1 FROM ${projectWorkspace}
          JOIN ${workspace} ON ${workspace.id} = ${projectWorkspace.workspaceId}
          WHERE ${projectWorkspace.projectId} = ${projectId}
            AND ${workspace.id} <> ${workspaceId}
            AND ${workspace.archivedAt} IS NULL
        )`
      )
    )
    .returning({ id: project.id })
  return archived.length > 0
}

/**
 * Moves the detached subtree into a new Project and returns its id; null for a legacy
 * unassigned subtree. Called before clearing the edge, under the existing lineage lock.
 */
export async function splitForkProject(
  tx: DbTransaction,
  workspaceId: string
): Promise<string | null> {
  const owner = await lockWorkspaceProject(tx, workspaceId)
  if (!owner) {
    await requireUnassignedForkSubtree(tx, workspaceId)
    return null
  }
  if (owner.archivedAt) throw new ProjectConflictError('Cannot disconnect an archived Project')
  const rows = await tx.execute<{
    id: string
    name: string
    owner_id: string
    archived_at: Date | null
    project_id: string | null
  }>(sql`${forkSubtree(workspaceId)}
    SELECT d.*, pw.project_id FROM descendants d LEFT JOIN project_workspace pw ON pw.workspace_id = d.id
  `)
  if (rows.some((row) => row.project_id !== owner.id))
    throw new ProjectConflictError(
      'Fork descendants need Project membership reconciliation before disconnecting'
    )
  const root = rows.find((row) => row.id === workspaceId)
  if (!root || rows.every((row) => row.archived_at))
    throw new ProjectConflictError('A new Project needs an active environment')
  const ids = rows.map((row) => row.id)
  const [remaining] = await tx
    .select({ id: workspace.id })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(
      and(
        eq(projectWorkspace.projectId, owner.id),
        isNull(workspace.archivedAt),
        notInArray(workspace.id, ids)
      )
    )
    .limit(1)
  if (!remaining)
    throw new ProjectConflictError(
      'Disconnecting would remove the last active environment from this Project'
    )
  const id = generateId()
  await tx.insert(project).values({
    id,
    name: generatedProjectName(root.name),
    organizationId: owner.organizationId,
    ownerId: root.owner_id,
  })
  await tx
    .update(projectWorkspace)
    .set({ projectId: id })
    .where(
      and(eq(projectWorkspace.projectId, owner.id), inArray(projectWorkspace.workspaceId, ids))
    )
  if (owner.organizationId) {
    await acquirePermissionGroupOrgLock(tx, owner.organizationId, {
      lockTimeoutAlreadyBounded: true,
    })
    await tx.execute(sql`
      UPDATE ${permissionGroup}
      SET config = jsonb_set(config, '{deniedPartialAccessProjectIssues}',
        (config->'deniedPartialAccessProjectIssues') || to_jsonb(${id}::text)), updated_at = now()
      WHERE organization_id = ${owner.organizationId}
        AND config->'deniedPartialAccessProjectIssues' ? ${owner.id}
    `)
  }
  return id
}

/**
 * Ownership changes include the complete Project; never silently split Project-wide
 * resources. Callers hold the organization mutation lock of every organization the
 * Projects leave, which serializes the permission-group edit with group mutations.
 */
export async function transferWorkspaceProjects(
  tx: DbTransaction,
  workspaceIds: string[],
  organizationId: string | null,
  ownerId?: string
): Promise<void> {
  if (!workspaceIds.length) return
  await lockProjectBackfillWrites(tx, workspaceIds)
  const owners = await tx
    .selectDistinct({ id: projectWorkspace.projectId })
    .from(projectWorkspace)
    .where(inArray(projectWorkspace.workspaceId, workspaceIds))
    .orderBy(asc(projectWorkspace.projectId))
  if (!owners.length) return
  const projectIds = owners.map((row) => row.id)
  await tryLockProjects(tx, projectIds)
  const selected = new Set(workspaceIds)
  const members = await tx
    .select({ id: projectWorkspace.workspaceId })
    .from(projectWorkspace)
    .where(inArray(projectWorkspace.projectId, projectIds))
  if (members.some((row) => !selected.has(row.id))) {
    throw new ProjectConflictError(
      'Move all environments in the Project together, or disconnect the fork first'
    )
  }
  const current = await tx
    .select({ id: project.id, organizationId: project.organizationId })
    .from(project)
    .where(inArray(project.id, projectIds))
  const leavingByOrganization = new Map<string, string[]>()
  for (const row of current) {
    if (!row.organizationId || row.organizationId === organizationId) continue
    const leaving = leavingByOrganization.get(row.organizationId)
    if (leaving) leaving.push(row.id)
    else leavingByOrganization.set(row.organizationId, [row.id])
  }
  for (const [previousOrganizationId, leaving] of leavingByOrganization) {
    const ids = textArrayLiteral(leaving)
    await tx.execute(sql`
      UPDATE ${permissionGroup}
      SET config = jsonb_set(config, '{deniedPartialAccessProjectIssues}',
        (config->'deniedPartialAccessProjectIssues') - ${ids}), updated_at = now()
      WHERE organization_id = ${previousOrganizationId}
        AND config->'deniedPartialAccessProjectIssues' ?| ${ids}
    `)
  }
  await tx
    .update(project)
    .set({ organizationId, ownerId, updatedAt: new Date() })
    .where(inArray(project.id, projectIds))
}

/**
 * Moves the organization Projects `fromUserId` owns to `toUserId`, alongside the
 * workspace ownership change that `workspaceIds` names.
 */
export async function reassignOrganizationProjects(
  tx: DbTransaction,
  input: { organizationId: string; fromUserId: string; toUserId: string; workspaceIds: string[] }
): Promise<void> {
  await lockProjectBackfillWrites(tx, input.workspaceIds)
  const owned = await tx
    .select({ id: project.id })
    .from(project)
    .where(
      and(eq(project.organizationId, input.organizationId), eq(project.ownerId, input.fromUserId))
    )
    .orderBy(asc(project.id))
  if (!owned.length) return
  await tryLockProjects(
    tx,
    owned.map((row) => row.id)
  )
  await tx
    .update(project)
    .set({ ownerId: input.toUserId, updatedAt: new Date() })
    .where(
      and(
        inArray(
          project.id,
          owned.map((row) => row.id)
        ),
        eq(project.organizationId, input.organizationId),
        eq(project.ownerId, input.fromUserId)
      )
    )
}

/**
 * Existing ownership paths can hold workspace rows first; refuse contention instead
 * of inverting locks.
 */
async function tryLockProjects(tx: DbTransaction, projectIds: string[]): Promise<void> {
  const keys = projectIds.map((id) => `project:${id}`)
  if (!(await tryAcquireAdvisoryXactLocks(tx, 'project', keys)))
    throw new ProjectConflictError('Project is changing; retry the ownership change')
}
