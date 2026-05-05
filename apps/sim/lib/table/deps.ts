/**
 * Pure dep-satisfaction helpers shared by the server-side scheduler and the
 * client UI. Lives in its own file (not `workflow-columns.ts`) so the client
 * can import it without pulling in `@sim/db` and other server-only deps.
 */

import type { RowData, RowExecutionMetadata, RowExecutions, TableRow, WorkflowGroup } from './types'

/**
 * Returns true when every dependency this group needs is filled. Plain
 * columns are filled when their value is non-empty; upstream groups are
 * filled when `executions[gid].status === 'completed'`. Used both by the
 * scheduler's eligibility check and by the manual "Run group" route, which
 * needs the same gate WITHOUT the in-flight / terminal-state check.
 */
export function areGroupDepsSatisfied(group: WorkflowGroup, row: TableRow): boolean {
  const deps = group.dependencies ?? {}
  for (const colName of deps.columns ?? []) {
    const value = row.data[colName]
    if (value === null || value === undefined || value === '') return false
  }
  for (const gid of deps.workflowGroups ?? []) {
    if (row.executions?.[gid]?.status !== 'completed') return false
  }
  return true
}

export interface UnmetDeps {
  /** Plain column names whose value on this row is empty. */
  columns: string[]
  /** Upstream workflow group ids that haven't reached `completed` on this row. */
  workflowGroups: string[]
}

/**
 * Like `areGroupDepsSatisfied` but returns *which* deps are unmet, so the UI
 * can render "Waiting on column_a, column_b". Returns empty arrays when
 * everything is filled.
 */
export function getUnmetGroupDeps(group: WorkflowGroup, row: TableRow): UnmetDeps {
  const deps = group.dependencies ?? {}
  const columns: string[] = []
  for (const colName of deps.columns ?? []) {
    const value = row.data[colName]
    if (value === null || value === undefined || value === '') columns.push(colName)
  }
  const workflowGroups: string[] = []
  for (const gid of deps.workflowGroups ?? []) {
    if (row.executions?.[gid]?.status !== 'completed') workflowGroups.push(gid)
  }
  return { columns, workflowGroups }
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
  for (const group of groups) {
    const wasSatisfied = areGroupDepsSatisfied(group, beforeRow)
    if (wasSatisfied) continue
    if (!areGroupDepsSatisfied(group, afterRow)) continue

    const exec = beforeRow.executions?.[group.id]
    // Don't overwrite an in-flight or terminal state — only "no exec" or a
    // prior `cancelled` / `error` is a candidate to retry on dep-fill.
    if (
      exec &&
      exec.status !== 'cancelled' &&
      exec.status !== 'error'
    ) {
      continue
    }

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
  return next
}
