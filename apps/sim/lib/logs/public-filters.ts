import { jobExecutionLogs, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/api/list-query'
import type { PersistedWorkflowExecutionStatus } from '@/lib/logs/types'

/** Query filters shared by the v1 and v2 public log adapters. */
export interface LogFilters {
  workspaceId: string
  workflowIds?: string[]
  folderIds?: string[]
  /**
   * Trigger types to include. `all` is a sentinel — a list containing it
   * disables this filter entirely rather than matching a trigger of that name.
   *
   * It is safe because `all` is modelled as a sentinel rather than a value:
   * `TriggerType` in `stores/logs/filters/types.ts` adds it alongside
   * `CoreTriggerType`, which never contains it, so no run is recorded under it.
   * It does mean the filterable vocabulary is one name smaller than the
   * column's, which is why the public `triggers` param documents the sentinel
   * instead of leaving a caller to discover it.
   */
  triggers?: string[]
  level?: 'info' | 'error'
  /**
   * Persisted execution statuses to include, matched against the same column the
   * responses report. Deliberately not derived from `level` + `ended_at` the way
   * the first-party list's `running`/`pending` pseudo-levels are: a filter that
   * selected on a different rule than the field it names would answer with rows
   * whose reported status is not the one asked for.
   */
  statuses?: PersistedWorkflowExecutionStatus[]
  /** Case-insensitive substring of the run's workflow name. */
  workflowName?: string
  startDate?: Date
  endDate?: Date
  executionId?: string
  minDurationMs?: number
  maxDurationMs?: number
  minCost?: number
  maxCost?: number
  model?: string
  /**
   * The v1 adapter's opaque `(startedAt, id)` position. Consumed by
   * `listPublicWorkflowLogs`, which translates it into the shared keyset — it is
   * deliberately NOT read here, so a filter set can never carry two different
   * spellings of the same page boundary into one query.
   */
  cursor?: {
    startedAt: string
    id: string
  }
  order?: 'desc' | 'asc'
}

export function buildLogFilters(filters: LogFilters): SQL<unknown> {
  const conditions: SQL<unknown>[] = []

  conditions.push(eq(workflowExecutionLogs.workspaceId, filters.workspaceId))

  // Workflow IDs filter
  if (filters.workflowIds && filters.workflowIds.length > 0) {
    conditions.push(inArray(workflow.id, filters.workflowIds))
  }

  // Folder IDs filter
  if (filters.folderIds && filters.folderIds.length > 0) {
    conditions.push(inArray(workflow.folderId, filters.folderIds))
  }

  // Triggers filter
  if (filters.triggers && filters.triggers.length > 0 && !filters.triggers.includes('all')) {
    conditions.push(inArray(workflowExecutionLogs.trigger, filters.triggers))
  }

  // Level filter
  if (filters.level) {
    conditions.push(eq(workflowExecutionLogs.level, filters.level))
  }

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(inArray(workflowExecutionLogs.status, filters.statuses))
  }

  // Workflow name filter — unindexed ILIKE, so the term is length-bounded at the
  // contract boundary. Wildcards in the term are escaped so `%` matches itself.
  if (filters.workflowName) {
    conditions.push(sql`${workflow.name} ILIKE ${`%${escapeLikePattern(filters.workflowName)}%`}`)
  }

  // Date range filters
  if (filters.startDate) {
    conditions.push(gte(workflowExecutionLogs.startedAt, filters.startDate))
  }

  if (filters.endDate) {
    conditions.push(lte(workflowExecutionLogs.startedAt, filters.endDate))
  }

  // Search filter (execution ID)
  if (filters.executionId) {
    conditions.push(eq(workflowExecutionLogs.executionId, filters.executionId))
  }

  // Duration filters
  if (filters.minDurationMs !== undefined) {
    conditions.push(gte(workflowExecutionLogs.totalDurationMs, filters.minDurationMs))
  }

  if (filters.maxDurationMs !== undefined) {
    conditions.push(lte(workflowExecutionLogs.totalDurationMs, filters.maxDurationMs))
  }

  // Cost filters — indexed projection of the usage_log ledger (dollars).
  if (filters.minCost !== undefined) {
    conditions.push(sql`${workflowExecutionLogs.costTotal} >= ${filters.minCost}`)
  }

  if (filters.maxCost !== undefined) {
    conditions.push(sql`${workflowExecutionLogs.costTotal} <= ${filters.maxCost}`)
  }

  // Model filter — uses the models_used projection (includes zero-cost/BYOK
  // models, which the usage_log ledger drops), preserving prior behavior.
  if (filters.model) {
    conditions.push(sql`${workflowExecutionLogs.modelsUsed} @> ARRAY[${filters.model}]::text[]`)
  }

  // Combine all conditions with AND
  return conditions.length > 0 ? and(...conditions)! : sql`true`
}

/**
 * Whether a filter set can select job runs at all.
 *
 * `job_execution_logs` has no workflow, no folder, no model projection, and no
 * comparable persisted status, so a filter naming any of those cannot be
 * satisfied by a job row. The honest answer is to drop the whole branch rather
 * than to silently ignore the filter for half the sequence — the first-party
 * list makes the same call in `list-logs.ts`, and letting one filter mean two
 * different things per branch is a wrong answer, not a partial one.
 */
export function jobLogsSelectable(filters: LogFilters): boolean {
  return (
    !filters.workflowIds &&
    !filters.folderIds &&
    !filters.workflowName &&
    !filters.model &&
    !filters.statuses
  )
}

/**
 * The job-run half of a unioned public log page.
 *
 * Only the filters `job_execution_logs` can actually answer are applied; callers
 * gate the branch on {@link jobLogsSelectable} first, so anything this builder
 * does not translate is a filter no job row could have matched.
 */
export function buildJobLogFilters(filters: LogFilters): SQL<unknown> {
  const conditions: SQL<unknown>[] = [eq(jobExecutionLogs.workspaceId, filters.workspaceId)]

  if (filters.triggers && filters.triggers.length > 0 && !filters.triggers.includes('all')) {
    conditions.push(inArray(jobExecutionLogs.trigger, filters.triggers))
  }

  if (filters.level) {
    conditions.push(eq(jobExecutionLogs.level, filters.level))
  }

  if (filters.startDate) {
    conditions.push(gte(jobExecutionLogs.startedAt, filters.startDate))
  }

  if (filters.endDate) {
    conditions.push(lte(jobExecutionLogs.startedAt, filters.endDate))
  }

  if (filters.executionId) {
    conditions.push(eq(jobExecutionLogs.executionId, filters.executionId))
  }

  if (filters.minDurationMs !== undefined) {
    conditions.push(gte(jobExecutionLogs.totalDurationMs, filters.minDurationMs))
  }

  if (filters.maxDurationMs !== undefined) {
    conditions.push(lte(jobExecutionLogs.totalDurationMs, filters.maxDurationMs))
  }

  // Job cost is a jsonb document rather than the indexed numeric projection the
  // workflow logs carry, so the bound is compared against the extracted total.
  if (filters.minCost !== undefined) {
    conditions.push(sql`(${jobExecutionLogs.cost}->>'total')::numeric >= ${filters.minCost}`)
  }

  if (filters.maxCost !== undefined) {
    conditions.push(sql`(${jobExecutionLogs.cost}->>'total')::numeric <= ${filters.maxCost}`)
  }

  return and(...conditions)!
}
