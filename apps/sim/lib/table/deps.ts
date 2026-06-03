/**
 * Pure dep-satisfaction helpers shared by the server-side scheduler and the
 * client UI. Lives in its own file (not `workflow-columns.ts`) so the client
 * can import it without pulling in `@sim/db` and other server-only deps.
 */

import { createLogger } from '@sim/logger'
import type { RowData, RowExecutionMetadata, RowExecutions, TableRow, WorkflowGroup } from './types'

const logger = createLogger('OptimisticCascade')

/**
 * True when the cell is `pending` / `queued` / `running`. Single source of
 * truth for the "is this exec in flight" classification across the
 * eligibility predicate, optimistic patches, status counters, and renderer.
 * `pending` counts even without a jobId so the row-gutter Stop button is
 * available the moment the user clicks Play — the cancel path writes
 * `cancelled` authoritatively whether or not a real trigger.dev run exists
 * yet, which is correct: cancel means "don't run this."
 */
export function isExecInFlight(exec: RowExecutionMetadata | undefined): boolean {
  if (!exec) return false
  const s = exec.status
  return s === 'queued' || s === 'running' || s === 'pending'
}

/**
 * A cell run the user/stop killed. The single source of truth for "do not run /
 * do not write this cell" — used by the in-memory write guard, the worker's
 * pre-execution check, and the resume worker. The SQL guard in
 * `writeExecutionsPatch` mirrors this status test in its `WHERE`.
 */
export function isExecCancelled(exec: RowExecutionMetadata | undefined): boolean {
  return exec?.status === 'cancelled'
}

/**
 * Cancelled AND killed after `since`. The dispatcher's tombstone test: a cell
 * cancelled after a dispatch was requested must be skipped by that dispatch's
 * later windows, even though the dispatcher pre-stamped it before the stop.
 */
export function isExecCancelledAfter(exec: RowExecutionMetadata | undefined, since: Date): boolean {
  if (!isExecCancelled(exec) || !exec?.cancelledAt) return false
  const at = Date.parse(exec.cancelledAt)
  return Number.isFinite(at) && at > since.getTime()
}

/**
 * A dependency column counts as unmet when its value is empty OR explicitly
 * `false`. An unchecked checkbox is treated as "dependency not satisfied", so
 * only checking a box (false→true) makes dependents eligible — unchecking
 * (true→false) never triggers a rerun.
 */
function isDepValueUnmet(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === false
}

/**
 * True when every output column the group writes still has a non-empty value
 * on this row. The "completed" exec status is metadata, but the cells are the
 * source of truth — if the user cleared an output cell, the row is effectively
 * incomplete and should be re-run on dep-fill / manual incomplete-mode runs.
 */
export function areOutputsFilled(group: WorkflowGroup, row: TableRow): boolean {
  if (group.outputs.length === 0) return true
  for (const o of group.outputs) {
    const v = row.data[o.columnName]
    if (v === null || v === undefined || v === '') return false
  }
  return true
}

/**
 * Returns true when every column this group depends on is non-empty on this
 * row. Workflow output columns count the same as plain columns — the model
 * is uniform.
 */
export function areGroupDepsSatisfied(group: WorkflowGroup, row: TableRow): boolean {
  const cols = group.dependencies?.columns ?? []
  for (const colName of cols) {
    if (isDepValueUnmet(row.data[colName])) return false
  }
  return true
}

export interface UnmetDeps {
  /** Column names whose value on this row is empty. */
  columns: string[]
}

/**
 * Like `areGroupDepsSatisfied` but returns *which* columns are unmet, so the
 * UI can render "Waiting on column_a, column_b".
 */
export function getUnmetGroupDeps(group: WorkflowGroup, row: TableRow): UnmetDeps {
  const cols = group.dependencies?.columns ?? []
  const columns: string[] = []
  for (const colName of cols) {
    if (isDepValueUnmet(row.data[colName])) columns.push(colName)
  }
  return { columns }
}

/**
 * Optimistic mirror of the server's row-update→scheduler cascade: for every
 * workflow group whose deps were unmet *before* the patch and are satisfied
 * *after*, OR whose dep column was touched by the patch (the server will
 * cancel+re-run via `deriveExecClearsForDataPatch` + the in-flight cancel
 * orchestration), return a new `executions` map with that group flipped to
 * `pending`. The cell renderer treats `pending` as "Queued".
 *
 * Returns `null` when nothing changed, so callers can short-circuit.
 */
export function optimisticallyScheduleNewlyEligibleGroups(
  groups: WorkflowGroup[],
  beforeRow: TableRow,
  patch: Partial<RowData>
): RowExecutions | null {
  if (groups.length === 0) return null

  const afterRow: TableRow = {
    ...beforeRow,
    data: { ...beforeRow.data, ...patch } as RowData,
  }
  const patchedColumns = new Set(Object.keys(patch))

  let next: RowExecutions | null = null
  let flipped = 0
  let skipped = 0
  for (const group of groups) {
    if (group.autoRun === false) {
      skipped++
      continue
    }
    if (!areGroupDepsSatisfied(group, afterRow)) {
      skipped++
      continue
    }

    const exec = beforeRow.executions?.[group.id]
    if (exec?.status === 'pending' && exec.jobId) {
      skipped++
      continue
    }

    const isStaleCompleted = exec?.status === 'completed' && !areOutputsFilled(group, afterRow)
    const wasSatisfied = areGroupDepsSatisfied(group, beforeRow)
    const becameSatisfied = !wasSatisfied
    const isRetryable = exec?.status === 'cancelled' || exec?.status === 'error'
    // Dep-column touched: the server clears terminal entries + cancels in-
    // flight downstream groups, so optimistically flip to `pending`
    // regardless of current exec status (queued/running included — they're
    // about to be cancelled and re-run).
    const depTouched = (group.dependencies?.columns ?? []).some((d) => patchedColumns.has(d))

    if (!depTouched && (exec?.status === 'queued' || exec?.status === 'running')) {
      skipped++
      continue
    }
    if (!becameSatisfied && !isStaleCompleted && !isRetryable && !depTouched && exec) {
      skipped++
      continue
    }

    flipped++
    if (next === null) next = { ...(beforeRow.executions ?? {}) }
    const pending: RowExecutionMetadata = {
      status: 'pending',
      executionId: exec?.executionId ?? null,
      jobId: null,
      workflowId: exec?.workflowId ?? group.workflowId,
      error: null,
    }
    next[group.id] = pending
  }
  if (flipped > 0) {
    logger.debug(`[OptimisticCascade] row=${beforeRow.id} flipped=${flipped} skipped=${skipped}`)
  }
  return next
}
