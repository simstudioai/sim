import type { ProjectArchiveRepair } from '@sim/db/maintenance/project-backfill'
import type { Sql } from 'postgres'

/** Runner-managed recovery state, like script_migrations; never an application ownership table. */
export async function ensureProjectArchiveRepairJournal(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS project_backfill_archive_repairs (
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
  const rows = await sql`UPDATE project_backfill_archive_repairs SET completed_at = now()
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
    await sql`SELECT count(*)::int AS count FROM project_backfill_archive_repairs WHERE completed_at IS NULL`
  return row.count
}
