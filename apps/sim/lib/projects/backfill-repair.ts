import {
  type ProjectArchiveRepair,
  ProjectBackfillBusy,
  ProjectBackfillConflict,
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
      .select({ archivedAt: sql<string | null>`${schema.workspace.archivedAt}::text` })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, repair.workspaceId))
      .for('no key update', { noWait: true })
    if (!current || current.archivedAt !== repair.archivedAt)
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
      await tx.execute(sql`INSERT INTO project_backfill_archive_repairs (workspace_id, repair)
      VALUES (${repair.workspaceId}, ${JSON.stringify(repair)}::text::jsonb)
      ON CONFLICT (workspace_id) DO UPDATE SET repair = EXCLUDED.repair, completed_at = NULL
      WHERE project_backfill_archive_repairs.repair = EXCLUDED.repair
        OR project_backfill_archive_repairs.completed_at IS NOT NULL
      RETURNING workspace_id`)
    if (!recorded.length)
      throw new ProjectBackfillConflict(
        'Finish the pending repair with its original manifest before replacing it'
      )
    await archiveEnvironmentInTransaction(
      tx,
      repair.workspaceId,
      new Date(`${repair.archivedAt.replace(' ', 'T')}Z`)
    )
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
