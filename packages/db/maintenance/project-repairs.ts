import {
  type ProjectArchiveRepair,
  tryProjectBackfillLocks,
} from '@sim/db/maintenance/project-backfill'
import { assertProjectColumnAuthority } from '@sim/db/maintenance/project-rollout'
import type { Sql } from 'postgres'

/** Runner-managed recovery state, like script_migrations; never an application ownership table. */
export async function ensureProjectArchiveRepairJournal(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS public.project_backfill_archive_repairs (
    workspace_id text PRIMARY KEY,
    repair jsonb NOT NULL,
    completed_at timestamptz
  )`
}

/** Written only after all external cleanup succeeds, so deployment cannot overlook a partial repair. */
export async function completeProjectArchiveRepair(
  sql: Sql,
  repair: ProjectArchiveRepair
): Promise<void> {
  const rows = await sql`UPDATE public.project_backfill_archive_repairs SET completed_at = now()
    WHERE workspace_id = ${repair.workspaceId} AND repair = ${JSON.stringify(repair)}::text::jsonb
    RETURNING workspace_id`
  if (!rows.length) throw new Error('Archive repair changed before cleanup completed')
}

/** Read-only, including on databases that have never needed archive repair. */
export async function countPendingProjectArchiveRepairs(sql: Sql): Promise<number> {
  const [state] =
    await sql`SELECT to_regclass('public.project_backfill_archive_repairs') IS NOT NULL AS present`
  if (!state.present) return 0
  const [row] =
    await sql`SELECT count(*)::int AS count FROM public.project_backfill_archive_repairs WHERE completed_at IS NULL`
  return row.count
}

/**
 * Repairs workflow archive state using database-only lifecycle effects. Provider-backed
 * subscriptions still require the application repair path and its durable cleanup receipt.
 */
export async function archiveProjectRepairWorkflows(
  sql: Sql,
  repair: ProjectArchiveRepair
): Promise<void> {
  if (!repair.workflowIds.length || repair.workflowIds.length > 1000)
    throw new Error('Expected a bounded workflow archive repair')
  await sql.begin(async (tx) => {
    await tx`SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
      THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true),
      set_config('statement_timeout', '3s', true), set_config('lock_timeout', '250ms', true)`
    await assertProjectColumnAuthority(tx)
    await tryProjectBackfillLocks(tx, [`project-backfill:${repair.workspaceId}`])
    const [workspace] = await tx`SELECT archived_at::text AS archived_at FROM workspace
      WHERE id = ${repair.workspaceId} FOR NO KEY UPDATE NOWAIT`
    if (!workspace || workspace.archived_at !== repair.archivedAt)
      throw new Error('Archived workspace changed; rediscover before repair')
    const workflows = await tx`SELECT id, workspace_id FROM workflow
      WHERE id = ANY(${repair.workflowIds}) OR (workspace_id = ${repair.workspaceId} AND archived_at IS NULL)
      ORDER BY id COLLATE "C" FOR NO KEY UPDATE NOWAIT`
    if (
      workflows.some(
        (row) => row.workspace_id !== repair.workspaceId || !repair.workflowIds.includes(row.id)
      )
    )
      throw new Error('Archive repair workflow membership changed; rediscover')
    const subscriptions =
      await tx`SELECT id FROM webhook WHERE workflow_id = ANY(${repair.workflowIds})
      AND (provider IS DISTINCT FROM 'generic'
        OR json_typeof(provider_config->'previousSubscription'->'provider') = 'string') LIMIT 1`
    if (subscriptions.length)
      throw new Error(
        'Archive repair requires external provider cleanup; use backfill-projects.ts plan/repair'
      )
    await tx`UPDATE workflow_deployment_operation SET status = 'superseded', completed_at = now(), updated_at = now()
      WHERE workflow_id = ANY(${repair.workflowIds}) AND status IN ('preparing', 'activating')`
    await tx`DELETE FROM webhook_path_claim WHERE workflow_id = ANY(${repair.workflowIds})`
    await tx`UPDATE workflow_schedule SET archived_at = ${repair.archivedAt}::text::timestamp, updated_at = now(),
      status = 'disabled', next_run_at = NULL, last_queued_at = NULL
      WHERE workflow_id = ANY(${repair.workflowIds}) AND archived_at IS NULL`
    await tx`UPDATE webhook SET archived_at = ${repair.archivedAt}::text::timestamp, updated_at = now(), is_active = false
      WHERE workflow_id = ANY(${repair.workflowIds}) AND archived_at IS NULL`
    await tx`UPDATE chat SET archived_at = ${repair.archivedAt}::text::timestamp, updated_at = now(), is_active = false
      WHERE workflow_id = ANY(${repair.workflowIds}) AND archived_at IS NULL`
    await tx`UPDATE workflow_mcp_tool SET archived_at = ${repair.archivedAt}::text::timestamp, updated_at = now()
      WHERE workflow_id = ANY(${repair.workflowIds}) AND archived_at IS NULL`
    await tx`UPDATE workflow_deployment_version SET is_active = false
      WHERE workflow_id = ANY(${repair.workflowIds}) AND is_active = true`
    await tx`UPDATE workflow SET archived_at = ${repair.archivedAt}::text::timestamp, updated_at = now(),
      is_deployed = false, is_public_api = false
      WHERE id = ANY(${repair.workflowIds}) AND archived_at IS NULL`
  })
}
