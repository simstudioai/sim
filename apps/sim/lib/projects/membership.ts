import { permissionGroup, project, projectWorkspace, workspace } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { compareStrings, truncateAtCodePoint } from '@sim/utils/string'
import { and, asc, eq, inArray, isNull, notInArray, type SQL, sql } from 'drizzle-orm'
import {
  type ChangeProjectStoragePayerParams,
  type ChangeWorkspaceStoragePayerParams,
  changeProjectAndWorkspaceStoragePayersInTx,
} from '@/lib/billing/storage/payer-transfer'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  acquireAdvisoryXactLock,
  acquireAdvisoryXactLocks,
  tryAcquireAdvisoryXactLocks,
} from '@/lib/db/advisory-locks'
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

/**
 * Waits in `acquire` are bounded by {@link PROJECT_LOCK_TIMEOUT_MS} and a timeout or
 * deadlock becomes a retryable Project conflict. The caller's own `lock_timeout` is
 * restored afterwards, so the bound never leaks into the work done under the locks.
 */
async function withProjectLockTimeout<T>(
  tx: DbTransaction,
  message: string,
  acquire: () => Promise<T>
): Promise<T> {
  const [setting] = await tx.execute<{ previous: string }>(
    sql`SELECT current_setting('lock_timeout') AS previous`
  )
  await tx.execute(sql`SELECT set_config('lock_timeout', ${`${PROJECT_LOCK_TIMEOUT_MS}ms`}, true)`)
  let result: T
  try {
    result = await acquire()
  } catch (error) {
    const code = getPostgresErrorCode(error)
    if (code === '55P03' || code === '40P01') throw new ProjectConflictError(message)
    throw error
  }
  await tx.execute(sql`SELECT set_config('lock_timeout', ${setting?.previous ?? '0'}, true)`)
  return result
}

/**
 * The advisory key the Project membership backfill holds exclusively per workspace while it
 * assigns it; writers take it shared. Every holder locks in code-unit order of workspace id
 * (`ORDER BY id COLLATE "C"` in SQL) so the two sides cannot deadlock.
 */
export function projectBackfillLockKey(workspaceId: string): string {
  return `project-backfill:${workspaceId}`
}

const BACKFILL_RUNNING = 'Project backfill is running; retry the operation'
const PROJECT_CHANGING = 'Project is changing; retry the operation'

function acquireBackfillWriteLocks(tx: DbTransaction, workspaceIds: string[]) {
  const locks = [...new Set(workspaceIds)]
    .sort(compareStrings)
    .map((id) => ({ key: projectBackfillLockKey(id), shared: true }))
  return acquireAdvisoryXactLocks(tx, 'project_backfill', locks)
}

/** Shared per-environment gate keeps membership absence reads stable during SQL backfill. */
export async function lockProjectBackfillWrites(
  tx: DbTransaction,
  workspaceIds: string[]
): Promise<void> {
  if (!workspaceIds.length) return
  await withProjectLockTimeout(tx, BACKFILL_RUNNING, () =>
    acquireBackfillWriteLocks(tx, workspaceIds)
  )
}

/** Canonical Project mutex; membership and lifecycle writers hold it until commit. */
export async function lockProject(tx: DbTransaction, projectId: string): Promise<void> {
  await withProjectLockTimeout(tx, PROJECT_CHANGING, () =>
    acquireAdvisoryXactLock(tx, 'project', projectLockKey(projectId))
  )
}

/** Takes several Project mutexes in code-unit id order, the order every multi-lock holder uses. */
export async function lockProjects(tx: DbTransaction, projectIds: string[]): Promise<void> {
  if (!projectIds.length) return
  const locks = [...new Set(projectIds)]
    .sort(compareStrings)
    .map((id) => ({ key: projectLockKey(id), shared: false }))
  await withProjectLockTimeout(tx, PROJECT_CHANGING, () =>
    acquireAdvisoryXactLocks(tx, 'project', locks)
  )
}

function projectLockKey(projectId: string): string {
  return `project:${projectId}`
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
    projectName?: string
  }
): Promise<string> {
  const id = generateId()
  await tx.insert(project).values({
    id,
    name: input.projectName ?? generatedProjectName(input.name),
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
  await tx.insert(projectWorkspace).values({ projectId: id, workspaceId: input.workspaceId })
  return id
}

/** Returns null only for a legacy workspace awaiting the SQL backfill. */
export async function lockWorkspaceProject(tx: DbTransaction, workspaceId: string) {
  return withProjectLockTimeout(tx, PROJECT_CHANGING, async () => {
    await acquireBackfillWriteLocks(tx, [workspaceId])
    const [membership] = await tx
      .select()
      .from(projectWorkspace)
      .where(eq(projectWorkspace.workspaceId, workspaceId))
      .limit(1)
    if (!membership) return null
    await acquireAdvisoryXactLock(tx, 'project', projectLockKey(membership.projectId))
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
  })
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
  const ids = descendants.map((row) => row.id)
  await lockProjectBackfillWrites(tx, ids)
  const rows = await tx
    .select({ id: projectWorkspace.workspaceId })
    .from(projectWorkspace)
    .where(inArray(projectWorkspace.workspaceId, ids))
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
    await acquirePermissionGroupOrgLock(tx, owner.organizationId)
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
  ownerId?: string,
  workspacePayerChanges: ChangeWorkspaceStoragePayerParams[] = []
): Promise<void> {
  if (!workspaceIds.length) return
  await lockProjectBackfillWrites(tx, workspaceIds)
  const owners = await tx
    .selectDistinct({ id: projectWorkspace.projectId })
    .from(projectWorkspace)
    .where(inArray(projectWorkspace.workspaceId, workspaceIds))
    .orderBy(asc(projectWorkspace.projectId))
  const projectIds = owners.map((row) => row.id)
  await tryLockProjects(tx, projectIds)
  const selected = new Set(workspaceIds)
  if (workspacePayerChanges.some((change) => !selected.has(change.workspaceId)))
    throw new Error('Workspace payer changes must belong to the selected Project environments')
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
    .select({ id: project.id, organizationId: project.organizationId, ownerId: project.ownerId })
    .from(project)
    .where(inArray(project.id, projectIds))
  if (current.length !== projectIds.length)
    throw new ProjectConflictError('Project ownership changed; retry')
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
  const projectChanges: ChangeProjectStoragePayerParams[] = current.map((row) => ({
    projectId: row.id,
    organizationId,
    ownerId: ownerId ?? row.ownerId,
    expectedCurrentOwner: { ownerId: row.ownerId, organizationId: row.organizationId },
  }))
  await changeProjectAndWorkspaceStoragePayersInTx(tx, {
    projectChanges,
    workspaceChanges: workspacePayerChanges,
  })
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
  const ids = owned.map((row) => row.id)
  await tryLockProjects(tx, ids)
  await tx
    .update(project)
    .set({ ownerId: input.toUserId, updatedAt: new Date() })
    .where(
      and(
        inArray(project.id, ids),
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
  const keys = projectIds.map(projectLockKey)
  if (!(await tryAcquireAdvisoryXactLocks(tx, 'project', keys)))
    throw new ProjectConflictError('Project is changing; retry the ownership change')
}
