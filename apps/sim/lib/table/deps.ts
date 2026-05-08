/**
 * Pure dep-satisfaction helpers shared by the server-side scheduler and the
 * client UI. Lives in its own file (not `workflow-columns.ts`) so the client
 * can import it without pulling in `@sim/db` and other server-only deps.
 */

import { createLogger } from '@sim/logger'
import type { RowData, RowExecutionMetadata, RowExecutions, TableRow, WorkflowGroup } from './types'

const logger = createLogger('OptimisticCascade')

/**
 * True when the cell has a worker actively reserved — `queued` / `running`,
 * or `pending` after the scheduler stamped a jobId. Single source of truth
 * for the "is this exec in flight" classification across the eligibility
 * predicate, optimistic patches, status counters, and renderer. `pending`
 * without a jobId is the optimistic-flag-only state, not in-flight.
 */
export function isExecInFlight(exec: RowExecutionMetadata | undefined): boolean {
  if (!exec) return false
  const s = exec.status
  if (s === 'queued' || s === 'running') return true
  if (s === 'pending' && exec.jobId) return true
  return false
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
    const value = row.data[colName]
    if (value === null || value === undefined || value === '') return false
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
    const value = row.data[colName]
    if (value === null || value === undefined || value === '') columns.push(colName)
  }
  return { columns }
}

/**
 * Optimistic mirror of the server's row-update→scheduler cascade: for every
 * workflow group whose deps were unmet *before* the patch and are satisfied
 * *after*, return a new `executions` map with that group flipped to
 * `pending`. The cell renderer treats `pending` as "Queued", which is what
 * the user expects to see immediately after they fill in the missing input —
 * not a flash of dash before the server's pending write arrives.
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
    if (exec?.status === 'queued' || exec?.status === 'running') {
      skipped++
      continue
    }
    if (exec?.status === 'pending' && exec.jobId) {
      skipped++
      continue
    }

    const isStaleCompleted = exec?.status === 'completed' && !areOutputsFilled(group, afterRow)
    const wasSatisfied = areGroupDepsSatisfied(group, beforeRow)
    const becameSatisfied = !wasSatisfied
    const isRetryable = exec?.status === 'cancelled' || exec?.status === 'error'
    if (!becameSatisfied && !isStaleCompleted && !isRetryable && exec) {
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
