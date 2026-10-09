import {
  type ProjectArchiveRepair,
  ProjectBackfillBusy,
  ProjectBackfillConflict,
  type ProjectBackfillWorkspace,
  type ProjectGroupingReview,
  projectGroupingEvidence,
} from '@sim/db/maintenance/project-backfill'
import {
  completeProjectArchiveRepair,
  ensureProjectArchiveRepairJournal,
} from '@sim/db/maintenance/project-repairs'
import * as schema from '@sim/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { Sql } from 'postgres'
import { tryAcquireAdvisoryXactLocks } from '@/lib/db/advisory-locks'
import { archiveProjectWithLastEnvironment, splitForkProject } from '@/lib/projects/membership'
import {
  archiveEnvironmentInTransaction,
  type EnvironmentArchiveEffects,
  finishEnvironmentArchive,
} from '@/lib/workspaces/lifecycle'

/**
 * Repairs reviewed legacy archives before membership enforcement. The immutable manifest retains
 * workflow identities before commit, so reruns can finish provider cleanup after a process crash.
 */
export async function repairArchivedProjectEnvironment(
  client: Sql,
  repair: ProjectArchiveRepair,
  requestId: string
): Promise<void> {
  await ensureProjectArchiveRepairJournal(client)
  const connection = drizzle({ client, schema })
  const effects = await connection.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
      THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true)`)
    await tx.execute(sql`SET LOCAL statement_timeout = '3s'`)
    await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`)
    if (
      !(await tryAcquireAdvisoryXactLocks(tx, 'project_backfill', [
        `project-backfill:${repair.workspaceId}`,
      ]))
    )
      throw new ProjectBackfillBusy('Archive repair workspace is busy')
    const [membership] = await tx
      .select({ projectId: schema.workspace.projectId })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, repair.workspaceId))
    if (
      membership?.projectId &&
      !(await tryAcquireAdvisoryXactLocks(tx, 'project', [`project:${membership.projectId}`]))
    )
      throw new ProjectBackfillBusy('Archive repair Project is busy')
    const [current] = await tx
      .select({
        projectId: schema.workspace.projectId,
        archivedAt: sql<string | null>`${schema.workspace.archivedAt}::text`,
      })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, repair.workspaceId))
      .for('no key update', { noWait: true })
    if (
      !current ||
      current.archivedAt !== repair.archivedAt ||
      current.projectId !== membership?.projectId
    )
      throw new ProjectBackfillConflict('Reviewed archive changed; rediscover')
    const active = await tx
      .select({ id: schema.workflow.id })
      .from(schema.workflow)
      .where(
        and(eq(schema.workflow.workspaceId, repair.workspaceId), isNull(schema.workflow.archivedAt))
      )
    if (active.some((row) => !repair.workflowIds.includes(row.id)))
      throw new ProjectBackfillConflict('New workflow found in reviewed archive; rediscover')
    const moved = await tx
      .select({ id: schema.workflow.id })
      .from(schema.workflow)
      .where(
        and(
          inArray(schema.workflow.id, repair.workflowIds),
          sql`${schema.workflow.workspaceId} IS DISTINCT FROM ${repair.workspaceId}`
        )
      )
      .limit(1)
    if (moved.length) throw new ProjectBackfillConflict('Reviewed workflow moved; rediscover')
    const recorded =
      await tx.execute(sql`INSERT INTO public.project_backfill_archive_repairs (workspace_id, repair)
      VALUES (${repair.workspaceId}, ${JSON.stringify(repair)}::text::jsonb)
      ON CONFLICT (workspace_id) DO UPDATE SET repair = EXCLUDED.repair, completed_at = NULL
      WHERE project_backfill_archive_repairs.repair = EXCLUDED.repair
        OR project_backfill_archive_repairs.completed_at IS NOT NULL
      RETURNING workspace_id`)
    if (!recorded.length)
      throw new ProjectBackfillConflict(
        'Finish the pending repair with its original manifest before replacing it'
      )
    const archivedAt = new Date(`${repair.archivedAt.replace(' ', 'T')}Z`)
    if (membership?.projectId) {
      const [legacy] = await tx.execute<{ present: boolean }>(
        sql`SELECT to_regclass('public.project_workspace') IS NOT NULL AS present`
      )
      const activeLegacy = legacy?.present
        ? await tx.execute(sql`
        SELECT 1 FROM project_workspace pw JOIN workspace w ON w.id = pw.workspace_id
        WHERE pw.project_id = ${membership.projectId} AND w.project_id IS NULL AND w.archived_at IS NULL LIMIT 1`)
        : []
      if (!activeLegacy.length)
        await archiveProjectWithLastEnvironment(
          tx,
          membership.projectId,
          repair.workspaceId,
          archivedAt
        )
    }
    await archiveEnvironmentInTransaction(tx, repair.workspaceId, archivedAt)
    const tools = await tx
      .select({
        workflowId: schema.workflowMcpTool.workflowId,
        serverId: schema.workflowMcpTool.serverId,
      })
      .from(schema.workflowMcpTool)
      .where(inArray(schema.workflowMcpTool.workflowId, repair.workflowIds))
    const servers = await tx
      .select({ id: schema.workflowMcpServer.id })
      .from(schema.workflowMcpServer)
      .where(eq(schema.workflowMcpServer.workspaceId, repair.workspaceId))
    const result: EnvironmentArchiveEffects = {
      workspaceId: repair.workspaceId,
      workflows: repair.workflowIds.map((id) => ({
        id,
        serverIds: tools.filter((tool) => tool.workflowId === id).map((tool) => tool.serverId),
      })),
      serverIds: servers.map((server) => server.id),
    }
    return result
  })
  await finishEnvironmentArchive(effects, requestId, { strictExternalCleanup: true })
  await completeProjectArchiveRepair(client, repair)
}

/** Repairs only an operator-named detached root, preserving the shared split policy and a replayable destination ID. */
export async function repairProjectGrouping(
  client: Sql,
  review: ProjectGroupingReview
): Promise<void> {
  const rootId = review.detachRootId
  if (
    review.decision !== 'detach' ||
    !rootId ||
    !review.roots.includes(rootId) ||
    review.destinationProjectId === review.projectId ||
    review.members.length > 1000 ||
    review.members.some((row) => row.projectId !== review.projectId) ||
    projectGroupingEvidence(review.members) !== review.evidence
  )
    throw new ProjectBackfillConflict(
      'Detach requires an exact reviewed, fully assigned Project; rediscover after apply'
    )
  const expected = new Map(review.members.map((row) => [row.id, row]))
  const root = expected.get(rootId)
  if (!root || root.parentId !== null)
    throw new ProjectBackfillConflict('Reviewed detached root is not independent')
  const targetIds = new Set([rootId])
  for (let size = 0; size !== targetIds.size; ) {
    size = targetIds.size
    for (const row of review.members)
      if (row.parentId && targetIds.has(row.parentId)) targetIds.add(row.id)
  }
  const target = review.members.filter((row) => targetIds.has(row.id))
  const connection = drizzle({ client, schema })
  await connection.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
      THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true)`)
    await tx.execute(sql`SET LOCAL statement_timeout = '3s'`)
    await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`)
    const keys = [
      `project:${review.projectId}`,
      `project:${review.destinationProjectId}`,
      ...review.roots.map((id) => `fork-lineage:${id}`),
      ...review.members.map((row) => `project-backfill:${row.id}`),
      ...(root.organizationId ? [`permission_group:${root.organizationId}`] : []),
    ]
    if (!(await tryAcquireAdvisoryXactLocks(tx, 'project_backfill', keys)))
      throw new ProjectBackfillBusy('Reviewed Project grouping is busy')
    const current = await tx.execute<ProjectBackfillWorkspace>(sql`
      SELECT id, forked_from_workspace_id AS "parentId", owner_id AS "ownerId",
        organization_id AS "organizationId", archived_at::text AS "archivedAt", project_id AS "projectId", NULL::text AS "legacyProjectId"
      FROM workspace WHERE project_id IN (${review.projectId},${review.destinationProjectId})
      ORDER BY id COLLATE "C" LIMIT 1001 FOR NO KEY UPDATE NOWAIT`)
    if (current.length > 1000)
      throw new ProjectBackfillConflict('Project grouping exceeds repair limit')
    const destination = current.filter((row) => row.projectId === review.destinationProjectId)
    if (destination.length) {
      if (
        projectGroupingEvidence(
          destination.map((row) => ({ ...row, projectId: review.projectId }))
        ) !== projectGroupingEvidence(target)
      )
        throw new ProjectBackfillConflict('Reviewed detach destination changed; rediscover')
      return
    }
    if (projectGroupingEvidence([...current]) !== review.evidence)
      throw new ProjectBackfillConflict('Reviewed Project grouping changed; rediscover')
    const [source] = await tx
      .select({ ownerId: schema.project.ownerId, organizationId: schema.project.organizationId })
      .from(schema.project)
      .where(eq(schema.project.id, review.projectId))
      .for('no key update', { noWait: true })
    if (
      !source ||
      current.some(
        (row) =>
          row.organizationId !== source.organizationId ||
          (source.organizationId === null && row.ownerId !== source.ownerId)
      )
    )
      throw new ProjectBackfillConflict(
        'Reviewed Project ownership or scope requires reconciliation before detach'
      )
    await splitForkProject(tx, rootId, review.destinationProjectId)
  })
}
