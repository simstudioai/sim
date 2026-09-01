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
import type { Column, SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'
import type { CsvSkippedRecord } from '@/lib/table/import'
import { pendingDeleteMask } from '@/lib/table/rows/pending-delete-mask'
import type {
  RowData,
  TableDefinition,
  TableDeleteJobPayload,
  TableExportJobPayload,
  TableJobType,
} from '@/lib/table/types'

/** Job fields projected onto a {@link TableDefinition}, derived from its latest `table_jobs` row. */
export interface DerivedJobFields {
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

/**
 * The shape every latest-job read produces, whether it comes back as query columns
 * (the batch `DISTINCT ON`) or as one jsonb object (the correlated lateral folded
 * into the table SELECT). The single source of truth for the doomed-count rule is
 * {@link mapJobRow} — never re-derive `pendingDeleteRemaining` at a call site.
 */
export interface LatestJobRow {
  id: string
  type: string
  status: string
  rowsProcessed: number
  error: string | null
  /**
   * The one field {@link mapJobRow} needs out of {@link TableDeleteJobPayload},
   * projected on its own so the read never drags the rest of the payload back.
   * `null` when the job has no payload, or a payload without the key.
   */
  doomedCount: number | null
}

export function mapJobRow(row: LatestJobRow | null | undefined): DerivedJobFields {
  if (!row) return EMPTY_JOB_FIELDS
  const doomedCount = row.type === 'delete' && row.status === 'running' ? (row.doomedCount ?? 0) : 0
  return {
    jobStatus: row.status as TableDefinition['jobStatus'],
    jobId: row.id,
    jobType: row.type as TableDefinition['jobType'],
    jobError: row.error,
    jobRowsProcessed: row.rowsProcessed,
    pendingDeleteRemaining: Math.max(0, doomedCount - row.rowsProcessed),
  }
}

/**
 * The one number {@link mapJobRow} wants out of `table_jobs.payload`, extracted in
 * SQL so the payload itself never crosses the wire. `payload` also carries the
 * delete job's `filter` and an unbounded `excludeRowIds` array, and the latest
 * non-export job is read on essentially every table request — a table that once ran
 * a large delete would otherwise ship that id list on every read, forever.
 *
 * `->` (not `->>`) keeps the value jsonb: postgres-js decodes jsonb through its
 * built-in `JSON.parse` handler (OID 3802), so this arrives as a JS `number`, or
 * `null` for a missing payload, a payload without the key, a payload that is not an
 * object, or an explicit JSON `null`. `->>` would hand back text and force a parse.
 * All four null cases collapse to the same `?? 0` {@link mapJobRow} already applied
 * to `payload?.doomedCount`, so no boundary coercion is needed.
 */
const doomedCountExpr = sql<number | null>`${tableJobs.payload}->'doomedCount'`

/**
 * What {@link mapJobRow} reads, as one source for both job reads: the batch
 * `DISTINCT ON` selects it directly, and {@link latestNonExportJobJson} derives its
 * `jsonb_build_object` pairs from it. Adding or renaming a field here reaches both —
 * the two cannot drift into disagreeing about what a job row is. Entries may be a
 * plain `Column` or a derived `SQL` expression; both render in either position.
 */
const JOB_PROJECTION = {
  id: tableJobs.id,
  type: tableJobs.type,
  status: tableJobs.status,
  rowsProcessed: tableJobs.rowsProcessed,
  error: tableJobs.error,
  doomedCount: doomedCountExpr,
} as const satisfies Record<keyof LatestJobRow, Column | SQL>

/**
 * The latest non-export job for one table, as a single jsonb value correlated to
 * `outerTableId` — i.e. a `LEFT JOIN LATERAL (... LIMIT 1) ON true` expressed in the
 * select list, which is the form drizzle can type without `leftJoinLateral`.
 *
 * It exists so {@link getTableById} stays ONE database round trip. With prepared
 * statements disabled (PgBouncer transaction mode) every extra `await` is a full
 * round trip, and `getTableById` is on essentially every table request. The job row
 * cannot simply be skipped: a table's reported `rowCount` is the stored count minus
 * this job's `pendingDeleteRemaining`, so the count and the job row are one read.
 *
 * Semantics match the batch {@link latestJobsForTables} exactly — same
 * {@link JOB_PROJECTION} fields (which is `doomedCount` extracted from the payload,
 * never the payload itself), exports excluded (they run concurrently and have their
 * own client surface), newest `started_at` first, one row. `NULL` when the table has
 * no such job; feed the result straight to {@link mapJobRow}.
 */
export function latestNonExportJobJson(outerTableId: Column): SQL<LatestJobRow | null> {
  // Keys come from JOB_PROJECTION, never from input, so `sql.raw` here cannot
  // carry anything a caller controls.
  const pairs = Object.entries(JOB_PROJECTION).flatMap(([key, expression]) => [
    sql.raw(`'${key}'`),
    expression,
  ])
  return sql<LatestJobRow | null>`(
    select jsonb_build_object(${sql.join(pairs, sql`, `)})
    from ${tableJobs}
    where ${tableJobs.tableId} = ${outerTableId} and ${tableJobs.type} <> 'export'
    order by ${tableJobs.startedAt} desc
    limit 1
  )`
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

/** Claims a job only when the canonical table remains in the expected workspace. */
export async function markTableJobRunningInWorkspace(
  tableId: string,
  workspaceId: string,
  jobId: string,
  type: TableJobType,
  payload?: unknown
): Promise<boolean> {
  const [definition] = await db
    .select({ workspaceId: userTableDefinitions.workspaceId })
    .from(userTableDefinitions)
    .where(
      and(eq(userTableDefinitions.id, tableId), eq(userTableDefinitions.workspaceId, workspaceId))
    )
    .limit(1)
  if (!definition) return false
  const inserted = await db
    .insert(tableJobs)
    .values({
      id: jobId,
      tableId,
      workspaceId: definition.workspaceId,
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

/** Releases only the active claim in the canonical workspace and reports no-op races. */
export async function releaseJobClaimInWorkspace(
  tableId: string,
  workspaceId: string,
  jobId: string
): Promise<boolean> {
  const released = await db
    .delete(tableJobs)
    .where(
      and(
        eq(tableJobs.id, jobId),
        eq(tableJobs.tableId, tableId),
        eq(tableJobs.workspaceId, workspaceId),
        eq(tableJobs.status, 'running')
      )
    )
    .returning({ id: tableJobs.id })
  return released.length > 0
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

/** Updates transfer progress under the job's canonical workspace scope. */
export async function updateJobProgressInWorkspace(
  tableId: string,
  workspaceId: string,
  rowsProcessed: number,
  jobId: string
): Promise<boolean> {
  const updated = await db
    .update(tableJobs)
    .set({ rowsProcessed, updatedAt: new Date() })
    .where(ownsActiveJobInWorkspace(tableId, workspaceId, jobId))
    .returning({ id: tableJobs.id })
  return updated.length > 0
}

/**
 * Rejection accounting an import worker folds into `table_jobs.payload`, so a partial
 * import is observable on the import record. Kept in the existing payload column
 * rather than new columns because the payload is already the job's type-specific
 * descriptor (see `doomedCount`), and an import record must be able to report loss
 * without a schema migration.
 */
export interface TableImportRejectionSummary {
  /**
   * Lower bound on the source records the CSV parser could not read and dropped —
   * one per parser failure, and a single failure can discard many records.
   */
  rowsRejected: number
  /** Non-empty cell values the target column type could not represent (stored as null). */
  cellsRejected: number
  /** Bounded sample of the dropped records, for locating them in the source file. */
  rejectedSamples: CsvSkippedRecord[]
}

/**
 * Merges an import's rejection summary into its job payload.
 *
 * Deliberately NOT scoped to `status = 'running'` like the progress writes: the summary is
 * written once the run is terminal (including cancel/failure), when the row is no longer
 * active. It is still scoped to the job id, table, workspace and type, so a stale worker can
 * only ever annotate its own job row. `||` merges into the existing payload, leaving the
 * import descriptor `parseImportJobPayload` reads intact.
 */
export async function recordImportRejections(
  tableId: string,
  workspaceId: string,
  jobId: string,
  summary: TableImportRejectionSummary
): Promise<void> {
  await db
    .update(tableJobs)
    .set({
      payload: sql`coalesce(${tableJobs.payload}, '{}'::jsonb) || ${JSON.stringify(summary)}::jsonb`,
    })
    .where(
      and(
        eq(tableJobs.id, jobId),
        eq(tableJobs.tableId, tableId),
        eq(tableJobs.workspaceId, workspaceId),
        eq(tableJobs.type, 'import')
      )
    )
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
 * user sees even after manual reorders. Keyset (not OFFSET) keeps each page O(page), with `id` as
 * the tiebreaker and the `(table_id, order_key, id)` index serving it. `order_key` is nullable —
 * rows predating the backfill, and forked rows that inherit a NULL key — so unkeyed rows form a
 * trailing segment the seek admits explicitly. The delete-job visibility mask applies, like every
 * user-facing read.
 */
export async function selectExportRowPage(
  table: TableDefinition,
  after: { orderKey: string | null; id: string } | null,
  limit: number
): Promise<Array<{ id: string; data: RowData; orderKey: string | null }>> {
  const deleteMask = await pendingDeleteMask(table)
  const rows = await db
    .select({ id: userTableRows.id, data: userTableRows.data, orderKey: userTableRows.orderKey })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, table.id),
        eq(userTableRows.workspaceId, table.workspaceId),
        deleteMask,
        // `order_key` is nullable and sorts LAST, so the page order is "keyed rows by
        // key, then the unkeyed tail by id". A bare row-constructor comparison is NULL
        // for unkeyed rows (dropping them) and NULL for an unkeyed anchor (dropping
        // everything), which silently truncates exports. Seek per anchor kind instead.
        after
          ? after.orderKey === null
            ? sql`${userTableRows.orderKey} IS NULL AND ${userTableRows.id} > ${after.id}`
            : sql`(${userTableRows.orderKey} IS NULL OR (${userTableRows.orderKey}, ${userTableRows.id}) > (${after.orderKey}, ${after.id}))`
          : undefined
      )
    )
    .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))
    .limit(limit)
  // drizzle types a jsonb column as `unknown`; every writer goes through the
  // row-data validators, so narrowing here is a projection, not an assumption.
  return rows.map((r) => ({ ...r, data: r.data as RowData }))
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

/** Stamps an export result only while the canonical workspace-scoped job is active. */
export async function setJobResultKeyInWorkspace(
  tableId: string,
  workspaceId: string,
  jobId: string,
  resultKey: string
): Promise<boolean> {
  const updated = await db
    .update(tableJobs)
    .set({
      payload: sql`coalesce(${tableJobs.payload}, '{}'::jsonb) || jsonb_build_object('resultKey', ${resultKey}::text)`,
      updatedAt: new Date(),
    })
    .where(ownsActiveJobInWorkspace(tableId, workspaceId, jobId))
    .returning({ id: tableJobs.id })
  return updated.length > 0
}

/** Shared WHERE for terminal transitions: this job run, and still in-flight (write-once). */
function ownsActiveJob(tableId: string, jobId: string) {
  return and(
    eq(tableJobs.id, jobId),
    eq(tableJobs.tableId, tableId),
    eq(tableJobs.status, 'running')
  )
}

function ownsActiveJobInWorkspace(tableId: string, workspaceId: string, jobId: string) {
  return and(
    eq(tableJobs.id, jobId),
    eq(tableJobs.tableId, tableId),
    eq(tableJobs.workspaceId, workspaceId),
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

/** Completes a transfer only while its canonical workspace-scoped job is active. */
export async function markJobReadyInWorkspace(
  tableId: string,
  workspaceId: string,
  jobId: string
): Promise<boolean> {
  const now = new Date()
  const updated = await db
    .update(tableJobs)
    .set({ status: 'ready', error: null, completedAt: now, updatedAt: now })
    .where(ownsActiveJobInWorkspace(tableId, workspaceId, jobId))
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

/** Fails a transfer only while its canonical workspace-scoped job is active. */
export async function markJobFailedInWorkspace(
  tableId: string,
  workspaceId: string,
  jobId: string,
  error: string
): Promise<boolean> {
  const now = new Date()
  const updated = await db
    .update(tableJobs)
    .set({ status: 'failed', error: error.slice(0, 2000), completedAt: now, updatedAt: now })
    .where(ownsActiveJobInWorkspace(tableId, workspaceId, jobId))
    .returning({ id: tableJobs.id })
  return updated.length > 0
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
