/**
 * Row-executions (workflow-group results) internals for the table service layer.
 *
 * Internal module: not exposed via the `@/lib/table` barrel. Consumers import
 * directly from `@/lib/table/rows/executions`.
 */

import { tableRowExecutions, userTableRows } from '@sim/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { getColumnId } from '@/lib/table/column-keys'
import { areGroupDepsSatisfied } from '@/lib/table/deps'
import { TableRunStateCollectionLimitExceededError } from '@/lib/table/rows/errors'
import { normalizeBlockErrors } from '@/lib/table/rows/run-state'
import type {
  EnrichmentRunDetail,
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  TableRow,
  TableSchema,
} from '@/lib/table/types'

/**
 * Rows whose sidecar is fetched per round trip. Bounds the `IN (...)` list and,
 * with it, the heap a single batch can materialize: `blockErrors` is unbounded
 * jsonb, so one query over a whole page's row ids has no ceiling of its own.
 */
const RUN_STATE_ID_CHUNK_SIZE = 250

interface LoadExecutionsOptions {
  /**
   * Ceiling on the serialized sidecar this call may materialize. Accumulated as
   * the drain proceeds and enforced BEFORE the next chunk is fetched, so a
   * refusal costs one over-budget chunk rather than the whole page — measuring
   * an already-materialized result could only report a spike that had already
   * happened.
   */
  budgetBytes?: number
}

/**
 * Loads `tableRowExecutions` rows for the given row ids and groups them into a
 * `Map<rowId, RowExecutions>` suitable for plugging into `TableRow.executions`.
 *
 * Drains in bounded chunks rather than one unbounded `IN (...)`. Pass
 * `budgetBytes` on any path that hands the sidecar to a caller; without it the
 * drain is still chunked but will read every named row.
 */
export async function loadExecutionsByRow(
  trx: DbOrTx,
  rowIds: Iterable<string>,
  options?: LoadExecutionsOptions
): Promise<Map<string, RowExecutions>> {
  const ids = Array.from(new Set(rowIds))
  const result = new Map<string, RowExecutions>()
  if (ids.length === 0) return result
  const budgetBytes = options?.budgetBytes
  let bytes = 0
  for (let offset = 0; offset < ids.length; offset += RUN_STATE_ID_CHUNK_SIZE) {
    if (budgetBytes !== undefined && bytes > budgetBytes) {
      throw new TableRunStateCollectionLimitExceededError(budgetBytes)
    }
    const chunk = ids.slice(offset, offset + RUN_STATE_ID_CHUNK_SIZE)
    // Explicit column list, never `select()` — `enrichmentDetails` is large and
    // must stay off the hot grid read path (fetched on demand via
    // `loadEnrichmentDetail`).
    const rows = await trx
      .select({
        rowId: tableRowExecutions.rowId,
        groupId: tableRowExecutions.groupId,
        status: tableRowExecutions.status,
        executionId: tableRowExecutions.executionId,
        jobId: tableRowExecutions.jobId,
        workflowId: tableRowExecutions.workflowId,
        error: tableRowExecutions.error,
        runningBlockIds: tableRowExecutions.runningBlockIds,
        blockErrors: tableRowExecutions.blockErrors,
        cancelledAt: tableRowExecutions.cancelledAt,
      })
      .from(tableRowExecutions)
      .where(inArray(tableRowExecutions.rowId, chunk))
    for (const r of rows) {
      const existing = result.get(r.rowId) ?? {}
      const blockErrors = normalizeBlockErrors(r.blockErrors)
      const meta: RowExecutionMetadata = {
        status: r.status as RowExecutionMetadata['status'],
        executionId: r.executionId ?? null,
        jobId: r.jobId ?? null,
        workflowId: r.workflowId,
        error: r.error ?? null,
        ...(r.runningBlockIds && r.runningBlockIds.length > 0
          ? { runningBlockIds: r.runningBlockIds }
          : {}),
        ...(blockErrors ? { blockErrors } : {}),
        ...(r.cancelledAt ? { cancelledAt: r.cancelledAt.toISOString() } : {}),
      }
      if (budgetBytes !== undefined) {
        bytes += Buffer.byteLength(JSON.stringify(meta), 'utf8')
        if (bytes > budgetBytes) {
          throw new TableRunStateCollectionLimitExceededError(budgetBytes)
        }
      }
      existing[r.groupId] = meta
      result.set(r.rowId, existing)
    }
  }
  return result
}

/** Convenience: load executions for one row, returning `{}` when missing. */
export async function loadExecutionsForRow(
  trx: DbOrTx,
  rowId: string,
  options?: LoadExecutionsOptions
): Promise<RowExecutions> {
  const byRow = await loadExecutionsByRow(trx, [rowId], options)
  return byRow.get(rowId) ?? {}
}

/**
 * Loads the enrichment cascade breakdown for one `(tableId, rowId, groupId)`,
 * or `null` when there is no exec row or it predates the feature. Read on demand
 * by the enrichment details panel — kept off `loadExecutionsByRow`.
 */
export async function loadEnrichmentDetail(
  trx: DbOrTx,
  tableId: string,
  rowId: string,
  groupId: string
): Promise<EnrichmentRunDetail | null> {
  const [row] = await trx
    .select({ enrichmentDetails: tableRowExecutions.enrichmentDetails })
    .from(tableRowExecutions)
    .where(
      and(
        eq(tableRowExecutions.tableId, tableId),
        eq(tableRowExecutions.rowId, rowId),
        eq(tableRowExecutions.groupId, groupId)
      ) as SQL
    )
    .limit(1)
  return (row?.enrichmentDetails as EnrichmentRunDetail | null | undefined) ?? null
}

/**
 * Derive automatic clears + cancellation candidates from a row's data patch.
 *
 * Walks `schema.workflowGroups` left-to-right with a propagating `dirtied`
 * column set. For each group whose deps overlap the dirty set, decide to
 * clear (terminal exec) or cancel+rerun (in-flight exec), then add the
 * group's outputs to the dirty set so later groups in the chain see them
 * as dirty too. This models transitive dep chains as a single forward pass —
 * editing column A propagates through group 1 (deps on A) to group 2 (deps
 * on group 1's output) without explicit DAG traversal.
 *
 * Returns:
 * - `executionsPatch`: caller's patch + nulls for cleared groups (or
 *   undefined if nothing applied).
 * - `inFlightDownstreamGroups`: groups whose dep was dirtied and that are
 *   currently in-flight. Cancel-and-restart is the caller's job.
 *
 * Assumption: `workflowGroups[]` is in topological order — a group's deps
 * may only reference columns to its left (enforced by `workflow-sidebar`'s
 * "Run after" picker + the reorder scrub via `stripGroupDeps`). Violating
 * this would silently miss the propagation.
 */
export function deriveExecClearsForDataPatch(
  dataPatch: RowData,
  schema: TableSchema,
  existingExecutions: RowExecutions,
  callerPatch: Record<string, RowExecutionMetadata | null> | undefined,
  mergedData: RowData
): {
  executionsPatch: Record<string, RowExecutionMetadata | null> | undefined
  inFlightDownstreamGroups: string[]
} {
  const dirtied = new Set(Object.keys(dataPatch))
  const groupsToClear = new Set<string>()
  const inFlightDownstreamGroups: string[] = []

  // Own-output clears: when the user wipes a workflow output column, drop
  // that group's exec entry so the auto-fire reactor re-arms the cell.
  // Also flags the cleared output column as dirty so transitive downstream
  // groups see it.
  for (const [columnId, value] of Object.entries(dataPatch)) {
    const cleared = value === null || value === undefined || value === ''
    if (!cleared) continue
    const col = schema.columns.find((c) => getColumnId(c) === columnId)
    if (col?.workflowGroupId) groupsToClear.add(col.workflowGroupId)
  }

  // Left-to-right walk, propagating dirty columns forward.
  const groups = schema.workflowGroups ?? []
  const afterRow = { data: mergedData } as TableRow
  for (const group of groups) {
    const deps = group.dependencies?.columns ?? []
    const depMatched = deps.some((d) => dirtied.has(d))
    if (!depMatched) continue

    // A dep column changed, but if the group's deps are no longer satisfied
    // after the patch — a checkbox was unchecked or a text dep cleared — there's
    // nothing to recompute. Leave the prior result alone instead of re-arming or
    // cancelling it; only checking a box / filling a dep drives downstream work.
    if (!areGroupDepsSatisfied(group, afterRow)) continue

    const exec = existingExecutions[group.id]
    if (exec) {
      const status = exec.status
      if (status === 'completed' || status === 'error' || status === 'cancelled') {
        groupsToClear.add(group.id)
      } else if (status === 'queued' || status === 'running' || status === 'pending') {
        inFlightDownstreamGroups.push(group.id)
      }
    } else {
      // No exec entry yet — `mode: 'new'` already covers this group. We
      // still propagate the dirty signal forward so later groups in the
      // chain see this group's outputs as dirty too.
      groupsToClear.add(group.id)
    }

    // Propagate: this group is about to be re-computed, so groups whose
    // deps reference its output columns are also dirty.
    for (const out of group.outputs) dirtied.add(out.columnName)
  }

  if (groupsToClear.size === 0) {
    return { executionsPatch: callerPatch, inFlightDownstreamGroups }
  }
  const merged: Record<string, RowExecutionMetadata | null> = { ...(callerPatch ?? {}) }
  for (const gid of groupsToClear) {
    if (!(gid in merged)) merged[gid] = null
  }
  return { executionsPatch: merged, inFlightDownstreamGroups }
}

/** Merges an `executionsPatch` into the row's existing executions blob. */
export function applyExecutionsPatch(
  existing: RowExecutions,
  patch: Record<string, RowExecutionMetadata | null> | undefined
): RowExecutions {
  if (!patch) return existing
  const next: RowExecutions = { ...existing }
  for (const [gid, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[gid]
    } else {
      next[gid] = value
    }
  }
  return next
}

/**
 * Writes a per-group execution patch for one row against the `tableRowExecutions`
 * sidecar. Non-null values upsert into the table; nulls delete the entry. When
 * `guard` is set, both upserts and null deletions are gated to:
 *  - reject if a `cancelled` row for the same execution already exists, and
 *  - reject if the row exists but is owned by a different executionId
 *    (with carve-outs for missing rows and null executionIds — the dispatcher's
 *    pre-batch `pending` stamp leaves executionId unset so the first cell-task
 *    can claim).
 *
 * Returns `'guard-rejected'` when the guarded group's upsert affected 0 rows
 * (callers signal failure to the cell-task path). Returns `'wrote'` otherwise.
 */
export async function writeExecutionsPatch(
  trx: DbOrTx,
  tableId: string,
  rowId: string,
  patch: Record<string, RowExecutionMetadata | null> | undefined,
  guard?: {
    groupId: string
    executionId: string
    allowNewExecution?: boolean
  }
): Promise<'wrote' | 'guard-rejected'> {
  if (!patch) return 'wrote'
  const entries = Object.entries(patch)
  if (entries.length === 0) return 'wrote'

  for (const [gid, value] of entries) {
    const isGuarded = guard && guard.groupId === gid
    if (value === null) {
      const deleteCondition = isGuarded
        ? and(
            eq(tableRowExecutions.rowId, rowId),
            eq(tableRowExecutions.groupId, gid),
            sql`${tableRowExecutions.status} <> 'cancelled'`,
            sql`(${tableRowExecutions.executionId} IS NULL OR ${tableRowExecutions.executionId} = ${guard.executionId})`
          )
        : and(eq(tableRowExecutions.rowId, rowId), eq(tableRowExecutions.groupId, gid))
      const deleted = await trx
        .delete(tableRowExecutions)
        .where(deleteCondition as SQL)
        .returning({ rowId: tableRowExecutions.rowId })
      if (isGuarded && deleted.length === 0) return 'guard-rejected'
      continue
    }
    const insertValues = {
      tableId,
      rowId,
      groupId: gid,
      status: value.status,
      executionId: value.executionId,
      jobId: value.jobId,
      workflowId: value.workflowId,
      error: value.error,
      runningBlockIds: value.runningBlockIds ?? [],
      blockErrors: value.blockErrors ?? {},
      cancelledAt: value.cancelledAt ? new Date(value.cancelledAt) : null,
      enrichmentDetails: value.enrichmentDetails ?? null,
      updatedAt: new Date(),
    } as const

    if (isGuarded) {
      // Gate by guard semantics. The original JSONB guard had two AND'd
      // clauses; we collapse them onto the upsert's WHERE so a non-matching
      // existing row leaves the table untouched and we observe 0 affected.
      const guardExecutionId = guard.executionId
      const guardCondition = guard.allowNewExecution
        ? sql`(${tableRowExecutions.executionId} IS DISTINCT FROM ${guardExecutionId} OR ${tableRowExecutions.status} = 'pending')`
        : and(
            // Reject any guarded worker write when the cell is `cancelled` — a
            // stop click wrote it authoritatively. SQL mirror of `isExecCancelled`
            // (deps.ts). Status-only (not executionId-scoped): the cancel can
            // only carry the pre-stamp's executionId (often null), so matching on
            // id would let the worker's real-id claim resurrect a killed cell.
            sql`${tableRowExecutions.status} <> 'cancelled'`,
            // Stale-worker: the cell's active run has moved on. Carve-outs
            // permit a fresh worker to take over when the row's executionId
            // is unset (dispatcher's pre-batch `pending` stamp).
            sql`(${tableRowExecutions.executionId} IS NULL OR ${tableRowExecutions.executionId} = ${guardExecutionId})`
          )
      const updated = await trx
        .insert(tableRowExecutions)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [tableRowExecutions.rowId, tableRowExecutions.groupId],
          set: {
            status: insertValues.status,
            executionId: insertValues.executionId,
            jobId: insertValues.jobId,
            workflowId: insertValues.workflowId,
            error: insertValues.error,
            runningBlockIds: insertValues.runningBlockIds,
            blockErrors: insertValues.blockErrors,
            cancelledAt: insertValues.cancelledAt,
            // Sticky: preserve a prior cascade breakdown when this write omits
            // it (e.g. the running pickup stamp) so only an explicit detail
            // overwrites it. Re-runs delete the row first, so this never serves
            // stale detail across runs.
            enrichmentDetails: sql`coalesce(excluded.enrichment_details, ${tableRowExecutions.enrichmentDetails})`,
            updatedAt: insertValues.updatedAt,
          },
          where: guardCondition as SQL,
        })
        .returning({ rowId: tableRowExecutions.rowId })
      if (updated.length === 0) return 'guard-rejected'
      continue
    }

    await trx
      .insert(tableRowExecutions)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [tableRowExecutions.rowId, tableRowExecutions.groupId],
        set: {
          status: insertValues.status,
          executionId: insertValues.executionId,
          jobId: insertValues.jobId,
          workflowId: insertValues.workflowId,
          error: insertValues.error,
          runningBlockIds: insertValues.runningBlockIds,
          blockErrors: insertValues.blockErrors,
          cancelledAt: insertValues.cancelledAt,
          // Sticky: preserve a prior cascade breakdown when this write omits it
          // (e.g. the running pickup stamp) so only an explicit detail overwrites
          // it. Re-runs delete the row first, so this never serves stale detail.
          enrichmentDetails: sql`coalesce(excluded.enrichment_details, ${tableRowExecutions.enrichmentDetails})`,
          updatedAt: insertValues.updatedAt,
        },
      })
  }

  return 'wrote'
}

/**
 * Strips the given workflow group ids from every row's executions on a table —
 * used by the column / group delete paths so stale running/queued exec records
 * don't linger and inflate counters after the group is gone. The caller wraps
 * in their own transaction.
 */
export async function stripGroupExecutions(
  trx: DbOrTx,
  tableId: string,
  groupIds: Iterable<string>,
  options?: { expectedWorkspaceId?: string }
): Promise<void> {
  const ids = Array.from(new Set(groupIds))
  if (ids.length === 0) return
  await trx.delete(tableRowExecutions).where(
    and(
      eq(tableRowExecutions.tableId, tableId),
      inArray(tableRowExecutions.groupId, ids),
      options?.expectedWorkspaceId
        ? sql`EXISTS (
              SELECT 1 FROM ${userTableRows}
              WHERE ${userTableRows.id} = ${tableRowExecutions.rowId}
                AND ${userTableRows.workspaceId} = ${options.expectedWorkspaceId}
            )`
        : undefined
    ) as SQL
  )
}
