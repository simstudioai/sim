import { permissionGroup, project, projectWorkspace, workspace } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

/** Shared per-environment gate keeps membership absence reads stable during SQL backfill. */
export async function lockProjectBackfillWrites(
  tx: DbTransaction,
  workspaceIds: string[]
): Promise<void> {
  if (!workspaceIds.length) return
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
  try {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:' || id, 0))
      FROM (SELECT DISTINCT unnest(ARRAY[${sql.join(
        workspaceIds.map((id) => sql`${id}`),
        sql`, `
      )}]::text[]) AS id ORDER BY id) ids
    `)
  } catch (error) {
    if (getPostgresErrorCode(error) === '55P03')
      throw new OrchestrationError('conflict', 'Project backfill is running; retry the operation')
    throw error
  }
}

/** Canonical Project mutex; membership and lifecycle writers hold it until commit. */
export async function lockProject(tx: DbTransaction, projectId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('lock_timeout', '5000ms', true)`)
  try {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`project:${projectId}`}, 0))`
    )
  } catch (error) {
    if (getPostgresErrorCode(error) === '55P03')
      throw new OrchestrationError('conflict', 'Project is changing; retry the operation')
    throw error
  }
}

function generatedProjectName(workspaceName: string): string {
  const suffix = ' - Project'
  return `${(workspaceName.trim() || 'Untitled').slice(0, 100 - suffix.length)}${suffix}`
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
  await lockProject(tx, membership.projectId)
  const [current] = await tx
    .select({ project })
    .from(projectWorkspace)
    .innerJoin(project, eq(project.id, projectWorkspace.projectId))
    .where(eq(projectWorkspace.workspaceId, workspaceId))
    .limit(1)
  if (!current || current.project.id !== membership.projectId) {
    throw new OrchestrationError('conflict', 'Project membership changed; retry the operation')
  }
  return current.project
}

export async function requireForkProject(tx: DbTransaction, parentWorkspaceId: string) {
  const parent = await lockWorkspaceProject(tx, parentWorkspaceId)
  if (!parent) {
    await requireUnassignedForkSubtree(tx, parentWorkspaceId)
    return null
  }
  if (parent.archivedAt) throw new OrchestrationError('conflict', 'Cannot fork an archived Project')
  return parent
}

/** Legacy fallback must not hide partially assigned descendants. Caller holds the lineage lock. */
async function requireUnassignedForkSubtree(tx: DbTransaction, workspaceId: string): Promise<void> {
  const descendants = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM workspace WHERE id = ${workspaceId}
      UNION
      SELECT w.id FROM workspace w JOIN descendants d ON w.forked_from_workspace_id = d.id
    ) SELECT id FROM descendants
  `)
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
    throw new OrchestrationError(
      'conflict',
      'Fork descendants need Project membership reconciliation'
    )
}

/** Individual removal cannot leave an active Project without an active environment. */
export async function requireRemainingProjectEnvironment(
  tx: DbTransaction,
  workspaceId: string
): Promise<void> {
  const owner = await lockWorkspaceProject(tx, workspaceId)
  if (!owner) return
  const [remaining] = await tx
    .select({ id: workspace.id })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(
      and(
        eq(projectWorkspace.projectId, owner.id),
        ne(workspace.id, workspaceId),
        isNull(workspace.archivedAt)
      )
    )
    .limit(1)
  if (!remaining && !owner.archivedAt) {
    throw new OrchestrationError(
      'conflict',
      'The last active environment cannot be removed. Archive the Project instead.'
    )
  }
}

/** Called before clearing the edge, under the existing lineage lock. */
export async function splitForkProject(
  tx: DbTransaction,
  workspaceId: string
): Promise<string | null> {
  const owner = await lockWorkspaceProject(tx, workspaceId)
  if (!owner) {
    await requireUnassignedForkSubtree(tx, workspaceId)
    return null
  }
  if (owner.archivedAt)
    throw new OrchestrationError('conflict', 'Cannot disconnect an archived Project')
  const rows = await tx.execute<{
    id: string
    name: string
    owner_id: string
    archived_at: Date | null
    project_id: string | null
  }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, name, owner_id, archived_at FROM workspace WHERE id = ${workspaceId}
      UNION
      SELECT w.id, w.name, w.owner_id, w.archived_at FROM workspace w JOIN descendants d ON w.forked_from_workspace_id = d.id
    ) SELECT d.*, pw.project_id FROM descendants d LEFT JOIN project_workspace pw ON pw.workspace_id = d.id
  `)
  if (rows.some((row) => row.project_id !== owner.id))
    throw new OrchestrationError(
      'conflict',
      'Fork descendants need Project membership reconciliation before disconnecting'
    )
  const root = rows.find((row) => row.id === workspaceId)
  if (!root || rows.every((row) => row.archived_at))
    throw new OrchestrationError('conflict', 'A new Project needs an active environment')
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
    throw new OrchestrationError(
      'conflict',
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

/** Ownership changes include the complete Project; never silently split Project-wide resources. */
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
  const selected = new Set(workspaceIds)
  for (const owner of owners) {
    await tryLockProject(tx, owner.id)
    const members = await tx
      .select({ id: projectWorkspace.workspaceId })
      .from(projectWorkspace)
      .where(eq(projectWorkspace.projectId, owner.id))
    if (members.some((row) => !selected.has(row.id))) {
      throw new OrchestrationError(
        'conflict',
        'Move all environments in the Project together, or disconnect the fork first'
      )
    }
    const [current] = await tx
      .select({ organizationId: project.organizationId })
      .from(project)
      .where(eq(project.id, owner.id))
    if (current?.organizationId && current.organizationId !== organizationId) {
      await tx.execute(sql`
        UPDATE ${permissionGroup}
        SET config = jsonb_set(config, '{deniedPartialAccessProjectIssues}',
          (config->'deniedPartialAccessProjectIssues') - ${owner.id}), updated_at = now()
        WHERE organization_id = ${current.organizationId}
          AND config->'deniedPartialAccessProjectIssues' ? ${owner.id}
      `)
    }
    await tx
      .update(project)
      .set({
        organizationId,
        ownerId,
        updatedAt: new Date(),
      })
      .where(eq(project.id, owner.id))
  }
}

/** Existing ownership paths can hold workspace rows first; refuse contention instead of inverting locks. */
export async function tryLockProject(tx: DbOrTx, projectId: string): Promise<void> {
  const [lock] = await tx.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`project:${projectId}`}, 0)) AS acquired`
  )
  if (!lock?.acquired)
    throw new OrchestrationError('conflict', 'Project is changing; retry the ownership change')
}
