/**
 * Table background-job service for user tables.
 *
 * The `table_jobs` state machine (claim / progress / terminal transitions), the
 * latest-job reads that enrich a {@link TableDefinition}, and the export-job read
 * paths — extracted from the table service. Operates purely on the `table_jobs`
 * table (plus `selectExportRowPage`, which pages rows through the shared
 * `pendingDeleteMask`), so it never imports the table-root service.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 */

import { db } from '@sim/db'
import { tableJobs, userTableDefinitions, userTableRows } from '@sim/db/schema'
import { and, asc, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { pendingDeleteMask } from '@/lib/table/rows/service'
import type {
  RowData,
  TableDefinition,
  TableDeleteJobPayload,
  TableExportJobPayload,
  TableJobType,
} from '@/lib/table/types'

/** Job fields projected onto a {@link TableDefinition}, derived from its latest `table_jobs` row. */
interface DerivedJobFields {
  jobStatus: TableDefinition['jobStatus']
  jobId: string | null
  jobType: TableDefinition['jobType']
  jobError: string | null
  jobRowsProcessed: number
  /**
   * Rows a running delete job still has to remove (its doomed estimate minus
   * deletions so far). Internal to count adjustment — callers subtract it from
   * the raw `row_count` so list/detail counts match the read path's delete
   * mask (a mid-delete refresh must not resurrect the count). Not on the wire.
   */
  pendingDeleteRemaining: number
}

export const EMPTY_JOB_FIELDS: DerivedJobFields = {
  jobStatus: null,
  jobId: null,
  jobType: null,
  jobError: null,
  jobRowsProcessed: 0,
  pendingDeleteRemaining: 0,
}

function mapJobRow(
  row:
    | {
        id: string
        type: string
        status: string
        rowsProcessed: number
        error: string | null
        payload: unknown
      }
    | undefined
): DerivedJobFields {
  if (!row) return EMPTY_JOB_FIELDS
  const doomedCount =
    row.type === 'delete' && row.status === 'running'
      ? ((row.payload as TableDeleteJobPayload | null)?.doomedCount ?? 0)
      : 0
  return {
    jobStatus: row.status as TableDefinition['jobStatus'],
    jobId: row.id,
    jobType: row.type as TableDefinition['jobType'],
    jobError: row.error,
    jobRowsProcessed: row.rowsProcessed,
    pendingDeleteRemaining: Math.max(0, doomedCount - row.rowsProcessed),
  }
}

const JOB_PROJECTION = {
  id: tableJobs.id,
  type: tableJobs.type,
  status: tableJobs.status,
  rowsProcessed: tableJobs.rowsProcessed,
  error: tableJobs.error,
  payload: tableJobs.payload,
} as const

/**
 * The latest job for one table (the running one if present, else the most recent terminal).
 * Exports are excluded: they're read-only, run concurrently with other jobs, and have their own
 * client surface — surfacing one here would clobber the import/delete/backfill status the tray
 * and SSE consumer derive from these fields.
 */
export async function latestJobForTable(
  tableId: string,
  executor: DbOrTx = db
): Promise<DerivedJobFields> {
  const [row] = await executor
    .select(JOB_PROJECTION)
    .from(tableJobs)
    .where(and(eq(tableJobs.tableId, tableId), ne(tableJobs.type, 'export')))
    .orderBy(desc(tableJobs.startedAt))
    .limit(1)
  return mapJobRow(row)
}

/** Latest non-export job per table for a batch of ids, via `DISTINCT ON (table_id)`. */
export async function latestJobsForTables(
  tableIds: string[]
): Promise<Map<string, DerivedJobFields>> {
  const map = new Map<string, DerivedJobFields>()
  if (tableIds.length === 0) return map
  const rows = await db
    .selectDistinctOn([tableJobs.tableId], { tableId: tableJobs.tableId, ...JOB_PROJECTION })
    .from(tableJobs)
    .where(and(inArray(tableJobs.tableId, tableIds), ne(tableJobs.type, 'export')))
    .orderBy(tableJobs.tableId, desc(tableJobs.startedAt))
  for (const row of rows) map.set(row.tableId, mapJobRow(row))
  return map
}

/**
 * Atomically claims a table's single background-job slot by inserting a `running` row into
 * `table_jobs`. The partial-unique index on `table_id WHERE status = 'running'` is the
 * concurrency gate: a second insert while a job runs hits `ON CONFLICT DO NOTHING` and returns no
 * row, so import and delete (and two imports) are mutually exclusive for free. Returns whether it
 * claimed the slot; the caller returns 409 when it didn't.
 */
export async function markTableJobRunning(
  tableId: string,
  jobId: string,
  type: TableJobType,
  /** Type-specific scope persisted to `table_jobs.payload` (e.g. {@link TableDeleteJobPayload})
   *  so read paths can mask the job's effect while it runs. */
  payload?: unknown
): Promise<boolean> {
  // workspace_id is immutable; the atomic gate is the INSERT's conflict, not this read.
  const [def] = await db
    .select({ workspaceId: userTableDefinitions.workspaceId })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)
  if (!def) return false
  const inserted = await db
    .insert(tableJobs)
    .values({
      id: jobId,
      tableId,
      workspaceId: def.workspaceId,
      type,
      status: 'running',
      payload: payload ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: tableJobs.id })
  return inserted.length > 0
}

/**
 * Releases a claim taken by {@link markTableJobRunning} for a synchronous job — deletes the
 * transient claim row. Scoped to `jobId` + still-running so it only clears its own claim, never a
 * newer run. A sync route claims, writes, then releases here in a `finally`.
 */
export async function releaseJobClaim(tableId: string, jobId: string): Promise<void> {
  await db
    .delete(tableJobs)
    .where(
      and(eq(tableJobs.id, jobId), eq(tableJobs.tableId, tableId), eq(tableJobs.status, 'running'))
    )
}

/**
 * Records job progress (rows processed so far) and bumps `updated_at` so the stale-job janitor
 * (`cleanup-stale-executions`) sees a live heartbeat.
 *
 * Scoped to `jobId` AND `status = 'running'`: a stale/superseded worker no longer matches (its
 * write is a no-op), and once the job is terminal (e.g. canceled) the match fails too — so this
 * returning `false` is the worker's signal to stop. Returns whether this worker still owns an
 * in-flight job.
 */
export async function updateJobProgress(
  tableId: string,
  rowsProcessed: number,
  jobId: string
): Promise<boolean> {
  const updated = await db
    .update(tableJobs)
    .set({ rowsProcessed, updatedAt: new Date() })
    .where(ownsActiveJob(tableId, jobId))
    .returning({ id: tableJobs.id })
  return updated.length > 0
}

/**
 * Reads the persisted progress of an in-flight job this worker still owns (`null` when the job
 * was canceled/superseded). A retried run seeds its counter from this so progress stays
 * cumulative — earlier attempts' batches are already committed, and restarting from zero would
 * clobber `rows_processed` (and every count derived from it) with the retry's smaller number.
 */
export async function getJobProgress(tableId: string, jobId: string): Promise<number | null> {
  const [job] = await db
    .select({ rowsProcessed: tableJobs.rowsProcessed })
    .from(tableJobs)
    .where(ownsActiveJob(tableId, jobId))
    .limit(1)
  return job ? job.rowsProcessed : null
}

/**
 * One keyset page of rows for the export worker, ordered by `(order_key, id)` — the same
 * authoritative visual order the grid (`queryRows`) uses, so exports and snapshots match what the
 * user sees even after manual reorders. Keyset (not OFFSET) keeps each page O(page); `order_key` is
 * present on every row (always assigned on insert, backfilled for legacy rows) with `id` as the
 * tiebreaker, and the `(table_id, order_key, id)` index serves it. The delete-job visibility mask
 * applies, like every user-facing read.
 */
export async function selectExportRowPage(
  table: TableDefinition,
  after: { orderKey: string; id: string } | null,
  limit: number
): Promise<Array<{ id: string; data: RowData; orderKey: string }>> {
  const deleteMask = await pendingDeleteMask(table)
  const rows = await db
    .select({ id: userTableRows.id, data: userTableRows.data, orderKey: userTableRows.orderKey })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, table.id),
        eq(userTableRows.workspaceId, table.workspaceId),
        deleteMask,
        after
          ? sql`(${userTableRows.orderKey}, ${userTableRows.id}) > (${after.orderKey}, ${after.id})`
          : undefined
      )
    )
    .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))
    .limit(limit)
  return rows as Array<{ id: string; data: RowData; orderKey: string }>
}

/** How long a terminal export stays listable (and re-downloadable from the tray). */
const EXPORT_JOB_VISIBILITY_MS = 10 * 60 * 1000

export interface WorkspaceExportJob {
  jobId: string
  tableId: string
  tableName: string
  status: string
  rowsProcessed: number
  format: 'csv' | 'json'
  hasResult: boolean
  error: string | null
}

/**
 * Export jobs the tray surfaces for a workspace: everything running, plus terminals from the last
 * {@link EXPORT_JOB_VISIBILITY_MS} so a just-finished export stays re-downloadable. Exports live
 * outside the table-level job derivation (which excludes them), so this is their read path.
 */
export async function listWorkspaceExportJobs(workspaceId: string): Promise<WorkspaceExportJob[]> {
  const visibilityCutoff = new Date(Date.now() - EXPORT_JOB_VISIBILITY_MS)
  const rows = await db
    .select({
      jobId: tableJobs.id,
      tableId: tableJobs.tableId,
      tableName: userTableDefinitions.name,
      status: tableJobs.status,
      rowsProcessed: tableJobs.rowsProcessed,
      payload: tableJobs.payload,
      error: tableJobs.error,
    })
    .from(tableJobs)
    .innerJoin(userTableDefinitions, eq(userTableDefinitions.id, tableJobs.tableId))
    .where(
      and(
        eq(tableJobs.workspaceId, workspaceId),
        eq(tableJobs.type, 'export'),
        or(eq(tableJobs.status, 'running'), gt(tableJobs.updatedAt, visibilityCutoff))
      )
    )
    .orderBy(desc(tableJobs.startedAt))
  return rows.map((r) => {
    const payload = r.payload as TableExportJobPayload | null
    return {
      jobId: r.jobId,
      tableId: r.tableId,
      tableName: r.tableName,
      status: r.status,
      rowsProcessed: r.rowsProcessed,
      format: payload?.format ?? 'csv',
      hasResult: Boolean(payload?.resultKey),
      error: r.error,
    }
  })
}

/** Reads one job row (type/status/payload) scoped to its table. Null when absent. */
export async function getTableJob(
  tableId: string,
  jobId: string
): Promise<{ id: string; type: string; status: string; payload: unknown } | null> {
  const [job] = await db
    .select({
      id: tableJobs.id,
      type: tableJobs.type,
      status: tableJobs.status,
      payload: tableJobs.payload,
    })
    .from(tableJobs)
    .where(and(eq(tableJobs.id, jobId), eq(tableJobs.tableId, tableId)))
    .limit(1)
  return job ?? null
}

/**
 * Stamps an export job's generated-file storage key onto its payload (`{ resultKey }` merge).
 * Scoped to the still-running job so a superseded attempt can't clobber a newer run's result.
 * The download route reads it; the janitor deletes the file when the terminal job is pruned.
 */
export async function setJobResultKey(
  tableId: string,
  jobId: string,
  resultKey: string
): Promise<void> {
  await db
    .update(tableJobs)
    .set({
      payload: sql`coalesce(${tableJobs.payload}, '{}'::jsonb) || jsonb_build_object('resultKey', ${resultKey}::text)`,
      updatedAt: new Date(),
    })
    .where(ownsActiveJob(tableId, jobId))
}

/** Shared WHERE for terminal transitions: this job run, and still in-flight (write-once). */
function ownsActiveJob(tableId: string, jobId: string) {
  return and(
    eq(tableJobs.id, jobId),
    eq(tableJobs.tableId, tableId),
    eq(tableJobs.status, 'running')
  )
}

/**
 * Marks a job complete. No-op unless it's still this in-flight run. Returns whether it
 * transitioned, so the worker only emits the `ready` event when it actually won (and not after a
 * cancel / supersede).
 */
export async function markJobReady(tableId: string, jobId: string): Promise<boolean> {
  const now = new Date()
  const updated = await db
    .update(tableJobs)
    .set({ status: 'ready', error: null, completedAt: now, updatedAt: now })
    .where(ownsActiveJob(tableId, jobId))
    .returning({ id: tableJobs.id })
  return updated.length > 0
}

/**
 * Marks a job failed, leaving any already-committed work in place. No-op unless it's still this
 * in-flight run (so a stale worker can't clobber a newer job or a cancel).
 */
export async function markJobFailed(tableId: string, jobId: string, error: string): Promise<void> {
  const now = new Date()
  await db
    .update(tableJobs)
    .set({ status: 'failed', error: error.slice(0, 2000), completedAt: now, updatedAt: now })
    .where(ownsActiveJob(tableId, jobId))
}

/**
 * Marks an in-flight job canceled (user-initiated). No-op unless it's still running. The
 * worker's next ownership check then returns `false` and it stops; committed work is left in
 * place (no rollback). Returns whether a running job was actually canceled.
 */
export async function markJobCanceled(tableId: string, jobId: string): Promise<boolean> {
  const now = new Date()
  const updated = await db
    .update(tableJobs)
    .set({ status: 'canceled', completedAt: now, updatedAt: now })
    .where(ownsActiveJob(tableId, jobId))
    .returning({ id: tableJobs.id })
  return updated.length > 0
}
