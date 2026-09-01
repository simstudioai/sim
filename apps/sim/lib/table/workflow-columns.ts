/**
 * Server-side scheduler for workflow-group auto-execution. The cascade is
 * driven entirely by the eligibility predicate: each row-write fires the
 * scheduler, which considers any newly-eligible (row × group) pair (deps
 * just filled, upstream group just `completed`) and enqueues per-cell jobs.
 */

import { db } from '@sim/db'
import {
  pausedExecutions,
  tableRowExecutions,
  userTableRows as userTableRowsTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  findCause,
  getPostgresConstraintName,
  getPostgresErrorCode,
  toError,
} from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { EnqueueOptions, WorkflowGroupExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  getAsyncExecutionTimeoutForBillingAttribution,
  toTriggerMaxDurationSeconds,
} from '@/lib/core/execution-limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { buildCancelledExecution } from '@/lib/table/cell-write'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import type {
  Filter,
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  TableDefinition,
  TableRow,
  WorkflowGroup,
} from '@/lib/table/types'

const logger = createLogger('WorkflowGroupScheduler')

const TABLE_CANCELLATION_BATCH_SIZE = 100
const TABLE_CANCELLATION_MAX_ROWS = 5_000
const TABLE_CANCELLATION_CONCURRENCY = 10
const TABLE_TRIGGER_CANCELLATION_MAX_RUNS = 5_000
const TABLE_TRIGGER_CANCELLATION_RETENTION_MS = 14 * 24 * 60 * 60_000
const TABLE_ROW_EXECUTIONS_ROW_FK = 'table_row_executions_row_id_user_table_rows_id_fk'

import { USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { areGroupDepsSatisfied, areOutputsFilled, isExecInFlight } from '@/lib/table/deps'
import { resolveTableDispatchConcurrency } from '@/lib/table/dispatch-concurrency'
import type { DispatchLimit, DispatchMode } from '@/lib/table/dispatcher'
import { buildFilterClause } from '@/lib/table/sql'

export {
  getUnmetGroupDeps,
  optimisticallyScheduleNewlyEligibleGroups,
} from '@/lib/table/deps'

/**
 * Per-(row, group) eligibility for both the auto-fire reactor and manual
 * runs. Manual runs bypass the `autoRun === false` skip, and additionally
 * bypass the dep check for `autoRun === false` groups (those are user-model
 * "no deps, manual only").
 *
 * "Completed" status is treated as stale when any output cell is empty — the
 * cells win over the exec metadata, so deleting an output value re-arms the
 * row for the cascade and for manual incomplete-mode runs.
 */
/**
 * Reason codes the eligibility predicate emits. Stable strings so the caller
 * can aggregate skip reasons into one summary log per scheduler call instead
 * of allocating a per-cell debug line.
 */
export type EligibilityReason =
  | 'eligible'
  | 'autoRun-off'
  | 'in-flight'
  | 'completed-on-auto'
  | 'error-on-auto'
  | 'cancelled-on-auto'
  | 'completed-on-incomplete'
  | 'has-prior-attempt'
  | 'manual-bypass'
  | 'deps-unmet'

export function classifyEligibility(
  group: WorkflowGroup,
  row: TableRow,
  opts?: { isManualRun?: boolean; mode?: DispatchMode }
): EligibilityReason {
  const isManualRun = opts?.isManualRun ?? false
  const mode = opts?.mode ?? 'all'

  if (group.autoRun === false && !isManualRun) return 'autoRun-off'

  const exec = row.executions?.[group.id]
  // Dispatcher pre-stamp orphans (`pending` + `executionId: null`) are
  // placeholders left behind when a previous dispatcher loop wrote the stamp
  // but no cell-task picked up (cascade-lock contention, trigger.dev queue
  // failure, etc.). Treat them as claimable so a new dispatcher can re-enqueue
  // — without this carve-out the row would render "Queued" forever. Matches
  // the `pickNextEligibleGroupForRow` cascade-loop carve-out.
  const isOrphanPreStamp = exec?.status === 'pending' && exec.executionId == null
  if (!isOrphanPreStamp && isExecInFlight(exec)) return 'in-flight'
  const status = exec?.status

  // `mode: 'new'` is the auto-fire scope: only rows that have never been
  // attempted on this group run. Any pre-existing exec entry — completed,
  // cancelled, or error — keeps the cell sticky until the user manually
  // re-runs via "Run column" / "Run all rows" / "Run this row".
  // Exception: orphan pre-stamps are claimable (handled above).
  if (mode === 'new' && exec && !isOrphanPreStamp) return 'has-prior-attempt'

  const completedAndFilled = status === 'completed' && areOutputsFilled(group, row)
  // For an enrichment a `completed` run is terminal even with empty outputs —
  // a no-match is a real result, not an unfinished run. Treating it as "done"
  // stops the auto cascade from re-invoking billable provider calls on every
  // no-match row each dispatch. A genuine input change clears the exec entry
  // (see deriveExecClearsForDataPatch), so real re-runs still happen.
  const isDone = completedAndFilled || (group.type === 'enrichment' && status === 'completed')
  if (!isManualRun && isDone) return 'completed-on-auto'
  if (!isManualRun && status === 'error') return 'error-on-auto'
  if (!isManualRun && status === 'cancelled') return 'cancelled-on-auto'
  // Manual incomplete-mode runs (Run row / Run incomplete) treat a `completed`
  // group as done even if an output is blank — only "Run all" re-runs it. The
  // auto cascade still re-fills blank workflow outputs (completedAndFilled).
  if (mode === 'incomplete') {
    if (isManualRun ? status === 'completed' : isDone) {
      return 'completed-on-incomplete'
    }
  }

  if (isManualRun && group.autoRun === false) return 'manual-bypass'
  return areGroupDepsSatisfied(group, row) ? 'eligible' : 'deps-unmet'
}

export function isGroupEligible(
  group: WorkflowGroup,
  row: TableRow,
  opts?: { isManualRun?: boolean; mode?: 'all' | 'incomplete' }
): boolean {
  const reason = classifyEligibility(group, row, opts)
  return reason === 'eligible' || reason === 'manual-bypass'
}

/** Walks a row's workflow groups (in `workflowGroups` order) and returns the
 *  first one whose deps are met and that isn't already in-flight under a
 *  different worker. Skips `excludeGroupId` (the group we just finished in
 *  the cascade loop, to prevent self-retrigger). The cascade-loop is allowed
 *  to claim past a dispatcher pre-stamp (`pending` with `executionId: null`)
 *  — that's a placeholder, not a real worker claim. */
export function pickNextEligibleGroupForRow(
  table: TableDefinition,
  row: TableRow,
  excludeGroupId?: string
): WorkflowGroup | null {
  const groups = table.schema.workflowGroups ?? []
  for (const group of groups) {
    if (group.id === excludeGroupId) continue
    const exec = row.executions?.[group.id]
    // Dispatcher pre-stamp (pending + executionId: null) is a queued marker: an
    // explicit run request whose cell-task bailed on lock contention. It's the
    // handoff — the cascade owner runs it next. Treat it as `isManualRun` so an
    // explicitly-requested `autoRun: false` group is honored (the dispatcher
    // already applied manual eligibility before stamping it); groups with no
    // marker stay `isManualRun: false` so pure dep-fill auto-cascade still
    // respects `autoRun`. Either way the placeholder is cleared from the
    // eligibility view so the group is claimable.
    const isRequested = exec?.status === 'pending' && exec.executionId == null
    const effectiveRow = isRequested
      ? { ...row, executions: { ...row.executions, [group.id]: undefined } as RowExecutions }
      : row
    if (isGroupEligible(group, effectiveRow, { isManualRun: isRequested, mode: 'incomplete' })) {
      return group
    }
  }
  return null
}

/**
 * Shared options for the three `scheduleRuns*` entry points. `isManualRun`
 * flips two gates in the eligibility predicate so a manual click can re-run
 * terminal states and bypass the autoRun=false skip.
 */
export interface ScheduleOpts {
  groupId?: string
  groupIds?: string[]
  isManualRun?: boolean
  mode?: DispatchMode
}

/** Pure eligibility filter + payload building. Shared by the auto-fire path
 *  (`scheduleRunsForRows`) and the dispatcher's per-window batch path. */
export function buildPendingRuns(
  table: TableDefinition,
  rows: TableRow[],
  opts?: ScheduleOpts
): WorkflowGroupCellPayload[] {
  const allGroups = table.schema.workflowGroups ?? []
  if (allGroups.length === 0) return []
  if (rows.length === 0) return []

  const groupIdFilter = opts?.groupIds
    ? new Set(opts.groupIds)
    : opts?.groupId
      ? new Set([opts.groupId])
      : null
  const groups = groupIdFilter ? allGroups.filter((g) => groupIdFilter.has(g.id)) : allGroups
  if (groups.length === 0) return []

  const orderedRows = rows.length <= 1 ? rows : [...rows].sort((a, b) => a.position - b.position)

  const pendingRuns: WorkflowGroupCellPayload[] = []
  const reasonCounts: Partial<Record<EligibilityReason, number>> = {}

  for (const row of orderedRows) {
    for (const group of groups) {
      const reason = classifyEligibility(group, row, {
        isManualRun: opts?.isManualRun,
        mode: opts?.mode,
      })
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
      if (reason !== 'eligible' && reason !== 'manual-bypass') continue
      pendingRuns.push({
        tableId: table.id,
        tableName: table.name,
        rowId: row.id,
        groupId: group.id,
        workflowId: group.workflowId,
        ...(group.enrichmentId ? { enrichmentId: group.enrichmentId } : {}),
        workspaceId: table.workspaceId,
        executionId: generateId(),
      })
    }
  }

  logger.debug(
    `[Cascade] table=${table.id} rows=${rows.length} groups=${groups.length} manual=${opts?.isManualRun ?? false} mode=${opts?.mode ?? 'all'} reasons=${JSON.stringify(reasonCounts)}`
  )

  return pendingRuns
}

/** Build the per-cell `{payload, options}` items for `queue.batchEnqueue` /
 *  `queue.batchEnqueueAndWait`. Hydrates trigger.dev tags, concurrency keys,
 *  the inline runner, and the cancel key the inline backend uses to map a
 *  Stop click to the in-flight cell's AbortController.
 *
 *  `runner` is only used by the database backend; trigger.dev triggers by task
 *  id. The cell-job import pulls in the executor + blocks stack, so skip it on
 *  trigger.dev to avoid a multi-second dispatcher cold-start. The carrier is
 *  capped to the admitted workflow policy plus cleanup headroom. The carrier
 *  starts one absolute workflow deadline when it dequeues and every cascaded
 *  group inherits that same deadline rather than resetting the policy budget. */
export async function buildEnqueueItems(
  pendingRuns: WorkflowGroupCellPayload[],
  concurrencyLimit: number = TABLE_CONCURRENCY_LIMIT
): Promise<Array<{ payload: QueuedWorkflowGroupCellPayload; options: EnqueueOptions }>> {
  if (pendingRuns.length === 0) return []

  const {
    assertBillingAttributionSnapshot,
    resolveBillingAttribution,
    resolveSystemBillingAttribution,
  } = await import('@/lib/billing/core/billing-attribution')
  const attributions = new Map<string, Promise<BillingAttributionSnapshot>>()
  const hydratedRuns = await Promise.all(
    pendingRuns.map(async (runOpts) => {
      if (runOpts.billingAttribution) {
        return {
          ...runOpts,
          billingAttribution: assertBillingAttributionSnapshot(runOpts.billingAttribution),
        }
      }

      const attributionKey = runOpts.triggeredByUserId
        ? `actor:${runOpts.workspaceId}:${runOpts.triggeredByUserId}`
        : `system:${runOpts.workspaceId}`
      let attribution = attributions.get(attributionKey)
      if (!attribution) {
        attribution = runOpts.triggeredByUserId
          ? resolveBillingAttribution({
              actorUserId: runOpts.triggeredByUserId,
              workspaceId: runOpts.workspaceId,
            })
          : resolveSystemBillingAttribution(runOpts.workspaceId)
        attributions.set(attributionKey, attribution)
      }

      return { ...runOpts, billingAttribution: await attribution }
    })
  )
  const runner = isTriggerDevEnabled
    ? undefined
    : ((await import('@/background/workflow-column-execution'))
        .executeWorkflowGroupCellJob as EnqueueOptions['runner'])
  return hydratedRuns.map((runOpts) => {
    const executionTimeoutMs = getAsyncExecutionTimeoutForBillingAttribution(
      runOpts.billingAttribution
    )
    return {
      payload: { ...runOpts, executionTimeoutMs },
      options: {
        metadata: {
          workflowId: runOpts.workflowId,
          workspaceId: runOpts.workspaceId,
          correlation: buildWorkflowGroupExecutionCorrelation(runOpts),
        },
        concurrencyKey: runOpts.tableId,
        concurrencyLimit,
        tags: cellTagsFor(runOpts),
        maxDurationSeconds: toTriggerMaxDurationSeconds(executionTimeoutMs),
        ...(runner ? { runner } : {}),
        cancelKey: cellCancelKey(runOpts.tableId, runOpts.rowId, runOpts.groupId),
      },
    }
  })
}

/**
 * Builds the server-issued identity that distinguishes a workflow-group cell
 * attempt from a workflow invoked by a Table trigger block.
 */
export function buildWorkflowGroupExecutionCorrelation(
  run: Pick<
    WorkflowGroupCellPayload,
    'executionId' | 'workflowId' | 'tableId' | 'rowId' | 'groupId'
  >
): WorkflowGroupExecutionCorrelation {
  return {
    executionId: run.executionId,
    requestId: `wfgrp-${run.executionId}`,
    source: 'workflow_group',
    workflowId: run.workflowId,
    triggerType: 'table',
    tableId: run.tableId,
    rowId: run.rowId,
    groupId: run.groupId,
  }
}

/** Stable key for `cancelInlineRun` lookups. Stamped on every enqueue item by
 *  `buildEnqueueItems`; the cancel path computes the same key per cell. */
export function cellCancelKey(tableId: string, rowId: string, groupId: string): string {
  return `${tableId}:${rowId}:${groupId}`
}

/** Trigger.dev tags stamped on every `workflow-group-cell` run so tag-based
 *  cancel (`runs.list({ tag })` + `runs.cancel(id)`) can target a specific
 *  cell or table without needing per-cell jobIds. */
export function cellTagsFor(runOpts: WorkflowGroupCellPayload): string[] {
  return [`tableId:${runOpts.tableId}`, `rowId:${runOpts.rowId}`, `group:${runOpts.groupId}`]
}

/** Cancel every active trigger.dev `workflow-group-cell` run whose tags
 *  match. Paginates `runs.list` and fires `runs.cancel` per match. Errors
 *  are logged and swallowed — the cell-write SQL guard already makes
 *  workers no-op on cancelled rows whether or not trigger.dev acked the
 *  cancel, so partial failure is safe. */
export async function cancelCellRunsByTags(tags: string[]): Promise<void> {
  if (tags.length === 0) return
  const { runs } = await import('@trigger.dev/sdk')
  let inspectedRuns = 0
  let cancellationBatch: string[] = []

  const flushCancellationBatch = async (): Promise<void> => {
    const runIds = cancellationBatch
    cancellationBatch = []
    await Promise.allSettled(
      runIds.map((runId) =>
        runs.cancel(runId).catch((error) => {
          logger.warn(`cancelCellRunsByTags: cancel ${runId} failed`, {
            error: toError(error).message,
          })
        })
      )
    )
  }

  try {
    for await (const run of runs.list({
      tag: tags,
      taskIdentifier: 'workflow-group-cell',
      status: ['PENDING_VERSION', 'QUEUED', 'DEQUEUED', 'EXECUTING', 'WAITING', 'DELAYED'],
      from: new Date(Date.now() - TABLE_TRIGGER_CANCELLATION_RETENTION_MS),
      limit: TABLE_CANCELLATION_BATCH_SIZE,
    })) {
      if (inspectedRuns >= TABLE_TRIGGER_CANCELLATION_MAX_RUNS) {
        logger.warn('cancelCellRunsByTags: bounded run scan reached its safety cap', {
          tags,
          maxRuns: TABLE_TRIGGER_CANCELLATION_MAX_RUNS,
        })
        break
      }
      inspectedRuns++
      cancellationBatch.push(run.id)
      if (cancellationBatch.length >= TABLE_CANCELLATION_CONCURRENCY) {
        await flushCancellationBatch()
      }
    }
    if (cancellationBatch.length > 0) await flushCancellationBatch()
  } catch (error) {
    logger.warn(`cancelCellRunsByTags: list failed`, {
      tags,
      error: toError(error).message,
    })
  }
}

export function toTableRow(
  r: typeof userTableRowsTable.$inferSelect,
  executions: RowExecutions = {}
): TableRow {
  return {
    id: r.id,
    data: r.data as RowData,
    executions,
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export interface WorkflowGroupCellPayload {
  tableId: string
  tableName: string
  rowId: string
  groupId: string
  /** Backing workflow id for manual groups; `''` for enrichment groups. */
  workflowId: string
  /** Registry enrichment id for enrichment groups. */
  enrichmentId?: string
  workspaceId: string
  executionId: string
  /** Immutable actor/payer decision captured before the cell is queued. */
  billingAttribution?: BillingAttributionSnapshot
  /** Trusted attempt budget resolved before the cell enters the queue. */
  executionTimeoutMs?: number
  /** Owning dispatch, set by `dispatcherStep`. Lets the cell halt its dispatch
   *  on a hard stop (e.g. usage limit). Absent for cascade/auto-fire payloads
   *  that aren't driven by a dispatch. */
  dispatchId?: string
  /** User who triggered the run, for per-member usage attribution. Absent for
   *  auto-fire (row writes, CSV import) → billing falls back to the workspace
   *  billed account. */
  triggeredByUserId?: string
  /** Person whose permission group gates this cell's tools. Null/absent means
   *  no acting person, so no per-tool gate applies. Not `triggeredByUserId`:
   *  that is an attribution and names the workspace billed account when the
   *  credential names no human, which would run a bystander's denylist. */
  capabilityGovernedUserId?: string | null
}

export type QueuedWorkflowGroupCellPayload = Omit<
  WorkflowGroupCellPayload,
  'billingAttribution'
> & {
  billingAttribution: BillingAttributionSnapshot
}

/** Legacy per-table concurrency cap. The live cap is per-plan (see
 *  `getTableDispatchConcurrency`); this remains the fallback for dispatch rows
 *  that predate the `concurrency` column and for non-dispatch cell enqueues. */
export const TABLE_CONCURRENCY_LIMIT = 20

/**
 * Cancels in-flight workflow-group runs for a table or single row. Writes
 * `cancelled` authoritatively for every `running` or `pending` group
 * execution — the client-side write is the source of truth, independent of
 * whether the trigger.dev cancel reaches the worker before its terminal
 * write. Pass `groupIds` to restrict the cancel to a subset of groups on
 * the row (used by `updateRow` to cancel only the downstream groups whose
 * deps just changed). Pass `filter` (table-wide form only) to cancel just
 * the cells on rows matching it — a filtered "select all" must not stop
 * work on rows outside its scope, so like the per-row form it leaves
 * active dispatches running (their in-flight checks skip cancelled cells).
 */
export async function cancelWorkflowGroupRuns(
  tableId: string,
  rowId?: string,
  options?: {
    groupIds?: string[]
    filter?: Filter
    excludeRowIds?: string[]
    /** Set by a manual run cancelling prior work: its own already-inserted
     *  dispatch must survive the table-wide dispatch cancel. */
    spareDispatchId?: string
  }
): Promise<number> {
  const { getTableById } = await import('@/lib/table/service')
  const { updateRow } = await import('@/lib/table/rows/service')
  const { getJobQueue } = await import('@/lib/core/async-jobs/config')
  const { listActiveDispatches, markActiveDispatchesCancelled } = await import(
    '@/lib/table/dispatcher'
  )

  const table = await getTableById(tableId)
  if (!table) throw new OrchestrationError('not_found', 'Table not found')

  // Per-row cancel leaves the dispatcher alone — other rows in the same
  // dispatch keep running. Table-wide cancel must stop it, else the cursor
  // marches on and re-enqueues fresh cells past what we just cancelled.
  // Filter-scoped cancel stops only dispatches with that exact filter scope
  // (its own run); whole-table or differently-scoped dispatches keep running —
  // their cells cancelled below are skipped via `cancelledAt > requestedAt`.
  if (!rowId) {
    const cancelledDispatches = await markActiveDispatchesCancelled(tableId, {
      scopeFilter: options?.filter,
      spareExcludedRowIds: options?.excludeRowIds,
      spareDispatchId: options?.spareDispatchId,
    })
    logger.info(
      `cancelWorkflowGroupRuns: cancelled ${cancelledDispatches.length} active dispatch(es) for table ${tableId}`,
      { dispatchIds: cancelledDispatches.map((d) => d.id) }
    )
  }

  const allGroups = table.schema.workflowGroups ?? []
  if (allGroups.length === 0) return 0
  const groupIds = options?.groupIds
    ? new Set(allGroups.filter((g) => options.groupIds?.includes(g.id)).map((g) => g.id))
    : new Set(allGroups.map((g) => g.id))
  if (groupIds.size === 0) return 0

  // Per-row Stop on a row the dispatcher hasn't reached yet has no sidecar
  // entry to cancel — the dispatcher would later walk to that row, see no
  // exec, classify eligible, and re-fire. Pre-write `cancelled` tombstones
  // for active-dispatch in-scope groups so the existing `cancelledAt >
  // dispatch.requestedAt` filter in `dispatcherStep` catches them. Skip
  // when there's no active dispatch (nothing to outrun).
  let aheadOfCursorTombstones: Array<{ groupId: string; workflowId: string }> = []
  if (rowId) {
    const activeDispatches = await listActiveDispatches(tableId)
    const relevant = activeDispatches.filter((d) => {
      if (d.scope.rowIds && !d.scope.rowIds.includes(rowId)) return false
      return d.scope.groupIds.some((gid) => groupIds.has(gid))
    })
    if (relevant.length > 0) {
      // Intersection of targeted groups with active-dispatch scopes — only
      // these groups are at risk of being re-fired by an in-progress dispatch.
      const atRisk = new Set<string>()
      for (const d of relevant) {
        for (const gid of d.scope.groupIds) {
          if (groupIds.has(gid)) atRisk.add(gid)
        }
      }
      aheadOfCursorTombstones = Array.from(atRisk).map((gid) => ({
        groupId: gid,
        workflowId: allGroups.find((g) => g.id === gid)?.workflowId ?? '',
      }))
    }
  }

  // Always filter by tableId — for the per-row case this prevents a
  // cross-table rowId from doing a wasted DB round-trip and silently
  // under-counting in the response. For the table-wide case it's the
  // primary filter.
  const inFlightStatuses = ['running', 'queued', 'pending']
  const inFlightFilters = [
    eq(tableRowExecutions.tableId, tableId),
    inArray(tableRowExecutions.status, inFlightStatuses),
    inArray(tableRowExecutions.groupId, Array.from(groupIds)),
  ]
  if (rowId) {
    inFlightFilters.push(eq(tableRowExecutions.rowId, rowId))
  } else if (options?.excludeRowIds?.length) {
    // Select-all minus deselections: the deselected rows' cells keep running.
    inFlightFilters.push(notInArray(tableRowExecutions.rowId, options.excludeRowIds))
  }
  if (!rowId && options?.filter) {
    // Filter-scoped cancel: only cells on rows matching the filter. Semi-join
    // against the tenant's rows — the in-flight sidecar set is small, so the
    // jsonb predicate is evaluated on few rows.
    const filterClause = buildFilterClause(
      options.filter,
      USER_TABLE_ROWS_SQL_NAME,
      table.schema.columns
    )
    if (filterClause) {
      inFlightFilters.push(
        inArray(
          tableRowExecutions.rowId,
          db
            .select({ id: userTableRowsTable.id })
            .from(userTableRowsTable)
            .where(
              and(
                eq(userTableRowsTable.tableId, tableId),
                eq(userTableRowsTable.workspaceId, table.workspaceId),
                filterClause
              )
            )
        )
      )
    }
  }
  const queue = await getJobQueue()

  type RowMutation = {
    rowId: string
    executionsPatch: Record<string, RowExecutionMetadata>
    jobIds: string[]
    cancelledCount: number
  }
  const tagSweepPromise = isTriggerDevEnabled
    ? cancelCellRunsByTags(rowId ? [`rowId:${rowId}`] : [`tableId:${tableId}`])
    : Promise.resolve()
  let cursor: { rowId: string; groupId: string } | undefined
  let processedCount = 0
  let cancelledCount = 0
  let reachedEnd = false
  const handledGroupIds = new Set<string>()

  while (processedCount < TABLE_CANCELLATION_MAX_ROWS) {
    const pageFilters = [...inFlightFilters]
    if (cursor) {
      const cursorFilter = or(
        gt(tableRowExecutions.rowId, cursor.rowId),
        and(
          eq(tableRowExecutions.rowId, cursor.rowId),
          gt(tableRowExecutions.groupId, cursor.groupId)
        )
      )
      if (cursorFilter) pageFilters.push(cursorFilter)
    }

    const pageSize = Math.min(
      TABLE_CANCELLATION_BATCH_SIZE,
      TABLE_CANCELLATION_MAX_ROWS - processedCount
    )
    const inFlightRows = await db
      .select()
      .from(tableRowExecutions)
      .where(and(...pageFilters))
      .orderBy(asc(tableRowExecutions.rowId), asc(tableRowExecutions.groupId))
      .limit(pageSize)

    if (inFlightRows.length === 0) {
      reachedEnd = true
      break
    }

    const lastRow = inFlightRows.at(-1)
    if (lastRow) cursor = { rowId: lastRow.rowId, groupId: lastRow.groupId }
    processedCount += inFlightRows.length

    const byRow = new Map<string, RowMutation>()
    for (const executionRow of inFlightRows) {
      const prev: RowExecutionMetadata = {
        status: executionRow.status as RowExecutionMetadata['status'],
        executionId: executionRow.executionId ?? null,
        jobId: executionRow.jobId ?? null,
        workflowId: executionRow.workflowId,
        error: executionRow.error ?? null,
        ...(executionRow.blockErrors &&
        Object.keys(executionRow.blockErrors as Record<string, string>).length > 0
          ? { blockErrors: executionRow.blockErrors as Record<string, string> }
          : {}),
      }
      const existing = byRow.get(executionRow.rowId) ?? {
        rowId: executionRow.rowId,
        executionsPatch: {},
        jobIds: [],
        cancelledCount: 0,
      }
      if (prev.jobId) existing.jobIds.push(prev.jobId)
      existing.executionsPatch[executionRow.groupId] = buildCancelledExecution(prev)
      existing.cancelledCount++
      handledGroupIds.add(executionRow.groupId)
      byRow.set(executionRow.rowId, existing)
    }
    const mutations = Array.from(byRow.values())

    const pausedCancellations = inFlightRows
      .filter((executionRow) =>
        Boolean(executionRow.executionId && executionRow.jobId?.startsWith('paused-'))
      )
      .map((executionRow) => ({
        executionId: executionRow.executionId as string,
        workflowId: executionRow.workflowId,
      }))
    if (pausedCancellations.length > 0) {
      const { PauseResumeManager } = await import(
        '@/lib/workflows/executor/human-in-the-loop-manager'
      )
      await mapWithConcurrency(
        pausedCancellations,
        TABLE_CANCELLATION_CONCURRENCY,
        async (pausedCancellation) => {
          await PauseResumeManager.beginPausedCancellation(
            pausedCancellation.executionId,
            pausedCancellation.workflowId
          ).catch((error) => {
            logger.warn(`beginPausedCancellation failed for ${pausedCancellation.executionId}`, {
              error: toError(error).message,
            })
          })
        }
      )
    }

    for (const mutation of mutations) {
      for (const groupId of Object.keys(mutation.executionsPatch)) {
        queue.cancelByKey(cellCancelKey(tableId, mutation.rowId, groupId))
      }
    }
    const queuedJobs = mutations.flatMap((mutation) =>
      mutation.jobIds.map((jobId) => ({ jobId, rowId: mutation.rowId }))
    )
    await mapWithConcurrency(
      queuedJobs,
      TABLE_CANCELLATION_CONCURRENCY,
      async ({ jobId, rowId: cancelledRowId }) => {
        await queue.cancelJob(jobId).catch((error) => {
          logger.error(`Failed to cancel job ${jobId} for ${tableId}/${cancelledRowId}`, {
            error: toError(error).message,
          })
        })
      }
    )

    await mapWithConcurrency(mutations, TABLE_CANCELLATION_CONCURRENCY, async (mutation) => {
      try {
        const updated = await updateRow(
          {
            tableId,
            rowId: mutation.rowId,
            data: {},
            /** No cell values are written, so there is nothing to stamp. */
            secretProvenance: undefined,
            workspaceId: table.workspaceId,
            executionsPatch: mutation.executionsPatch,
          },
          table,
          `wfgrp-cancel-${mutation.rowId}`
        )
        if (!updated) throw new Error('Authoritative cancellation write was rejected')
      } catch (error) {
        const rowNotFound = findCause(
          error,
          (cause): cause is TableRowNotFoundError => cause instanceof TableRowNotFoundError
        )
        if (rowNotFound) return
        throw error
      }
    })
    cancelledCount += mutations.reduce((total, mutation) => total + mutation.cancelledCount, 0)

    if (inFlightRows.length < pageSize) {
      reachedEnd = true
      break
    }
  }

  if (!reachedEnd) {
    const now = new Date()
    logger.warn('cancelWorkflowGroupRuns reached its synchronous row safety cap', {
      tableId,
      maxRows: TABLE_CANCELLATION_MAX_ROWS,
    })
    const rows = await db.execute<{ count: number | string }>(sql`
      WITH cancelled AS (
        UPDATE ${tableRowExecutions}
        SET
          status = 'cancelled',
          job_id = NULL,
          error = 'Cancelled',
          running_block_ids = ARRAY[]::text[],
          cancelled_at = ${sql.param(now, tableRowExecutions.cancelledAt)},
          updated_at = ${sql.param(now, tableRowExecutions.updatedAt)}
        WHERE ${and(...inFlightFilters)}
        RETURNING 1
      )
      SELECT count(*)::integer AS count FROM cancelled
    `)
    const [countRow] = Array.isArray(rows) ? rows : []
    if (!countRow) throw new Error('Cancellation update did not return an affected count')
    const remainingCancelled = Number(countRow.count)
    if (!Number.isSafeInteger(remainingCancelled) || remainingCancelled < 0) {
      throw new Error('Cancellation update returned an invalid affected count')
    }
    cancelledCount += remainingCancelled
  }

  await tagSweepPromise

  // Tombstones for ahead-of-cursor groups. The in-flight cancel writes above
  // already cover groups that have a sidecar entry; we only need fresh
  // tombstones for groups that don't (the dispatcher hasn't reached them
  // yet, so there's nothing to cancel — but without a tombstone the
  // dispatcher would still re-fire when its cursor walks to this row).
  if (rowId && aheadOfCursorTombstones.length > 0) {
    const needsTombstone = aheadOfCursorTombstones.filter((t) => !handledGroupIds.has(t.groupId))
    if (needsTombstone.length > 0) {
      const now = new Date()
      await mapWithConcurrency(
        needsTombstone,
        TABLE_CANCELLATION_CONCURRENCY,
        async (tombstone) => {
          try {
            await db
              .insert(tableRowExecutions)
              .values({
                tableId,
                rowId,
                groupId: tombstone.groupId,
                status: 'cancelled',
                executionId: null,
                jobId: null,
                workflowId: tombstone.workflowId,
                error: 'Cancelled',
                runningBlockIds: [],
                blockErrors: {},
                cancelledAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing({
                target: [tableRowExecutions.rowId, tableRowExecutions.groupId],
              })
          } catch (error) {
            if (
              getPostgresErrorCode(error) === '23503' &&
              getPostgresConstraintName(error) === TABLE_ROW_EXECUTIONS_ROW_FK
            ) {
              return
            }
            throw error
          }
        }
      )
    }
  }

  return cancelledCount
}

/**
 * Run a set of groups across the table or a row subset. Single canonical
 * user-driven run op — every UI gesture (single cell, per-row Play, action-bar
 * Play/Refresh, column-header menu) reduces to this. `mode: 'all'` re-runs
 * completed cells; `mode: 'incomplete'` skips them. `groupIds` omitted = every
 * workflow group on the table. `rowIds` omitted = every row.
 */
export async function runWorkflowColumn(opts: {
  tableId: string
  workspaceId: string
  mode: DispatchMode
  requestId: string
  groupIds?: string[]
  rowIds?: string[]
  /** "Select all under a filter" — run every row matching this filter (mutually exclusive with
   *  `rowIds`). Threaded into the dispatch scope so the dispatcher walks only matching rows. */
  filter?: Filter
  /** Select-all scope only: deselected rows — the dispatcher walk, eager clear, and pre-run
   *  cancel all skip them. */
  excludeRowIds?: string[]
  /** Optional cap on work before the dispatch completes (e.g. run only the
   *  first N eligible rows). Null/omitted = process every row in scope. */
  limit?: DispatchLimit | null
  /** When false, eligibility honors `autoRun: false` and treats completed
   *  cells as terminal — appropriate for auto-fire after row writes or
   *  schema changes. Defaults to true (user-initiated "Run column"). */
  isManualRun?: boolean
  /** User who triggered the run, for usage attribution. Omitted by auto-fire
   *  callers (row writes, CSV import) → falls back to the workspace billed
   *  account at billing time. */
  triggeredByUserId?: string | null
  /** Person whose permission group gates the run's cells. Omitted by producers
   *  that cannot tell an acting person from an attribution fallback; those
   *  default to `triggeredByUserId` in `insertDispatch`. Pass it explicitly —
   *  `null` included — wherever the principal is in hand. */
  capabilityGovernedUserId?: string | null
}): Promise<{ dispatchId: string | null; shouldSignalRowsChanged: boolean }> {
  const {
    tableId,
    workspaceId,
    mode,
    requestId,
    groupIds,
    rowIds,
    filter,
    excludeRowIds,
    limit,
    triggeredByUserId,
    capabilityGovernedUserId,
  } = opts
  const isManualRun = opts.isManualRun ?? true
  // Empty `rowIds` array means "scope explicitly empty" — auto-fire callers
  // (CSV import on zero matches, etc.) end up here. Skip the dispatch entirely
  // rather than walk the table with a no-match filter.
  if (rowIds && rowIds.length === 0) {
    return { dispatchId: null, shouldSignalRowsChanged: false }
  }
  // Lazy imports: `./service` and `./dispatcher` both close cycles back to
  // this module; `@trigger.dev/sdk` is heavy and only needed on this op.
  const { getTableById } = await import('@/lib/table/service')
  const table = await getTableById(tableId)
  if (!table) throw new OrchestrationError('not_found', 'Table not found')
  if (table.workspaceId !== workspaceId)
    throw new OrchestrationError('validation', 'Invalid workspace ID')

  const allGroups = table.schema.workflowGroups ?? []
  const targetGroups = groupIds ? allGroups.filter((g) => groupIds.includes(g.id)) : allGroups
  // Tables with no workflow groups are the majority. Auto-fire callers from
  // every row write would otherwise produce error-level log spam on every
  // PATCH/insert. Manual run-column callers always pass `groupIds` so they
  // can't reach here with an empty target.
  if (targetGroups.length === 0) {
    return { dispatchId: null, shouldSignalRowsChanged: false }
  }
  const targetGroupIds = targetGroups.map((g) => g.id)
  let shouldSignalRowsChanged = false

  const {
    bulkClearWorkflowGroupCells,
    cancelDispatchById,
    insertDispatch,
    readDispatch,
    runDispatcherToCompletion,
  } = await import('./dispatcher')

  // Per-window parallelism follows the invoker's plan, resolved once here and
  // threaded through the dispatcher invocation (task payload / loop arg).
  const concurrency = await resolveTableDispatchConcurrency({
    workspaceId,
    actorUserId: triggeredByUserId,
  })

  // Always insert a `table_run_dispatches` row, and insert it FIRST — before
  // the prior-run cancel and the bulk clear below, which can take seconds on
  // a large table. The client shows its Stop control optimistically from the
  // moment the user clicks Run, so a Stop-all arriving during that prep work
  // must find a dispatch row to cancel; inserted-after ordering made an early
  // Stop-all a silent no-op and the run proceeded anyway. The dispatcher
  // state machine is the single source of truth for cursor advancement, SSE
  // emission, and cancel — backend (trigger.dev SaaS vs in-process) only
  // affects how each window's cells get executed.
  const dispatchId = await insertDispatch({
    tableId,
    workspaceId,
    requestId,
    mode,
    scope: {
      groupIds: targetGroupIds,
      ...(rowIds && rowIds.length > 0 ? { rowIds } : {}),
      ...(filter ? { filter } : {}),
      ...(excludeRowIds && excludeRowIds.length > 0 && !(rowIds && rowIds.length > 0)
        ? { excludeRowIds }
        : {}),
    },
    limit,
    isManualRun,
    triggeredByUserId,
    ...('capabilityGovernedUserId' in opts ? { capabilityGovernedUserId } : {}),
  })

  try {
    // For manual runs (Run all rows / Run column / Refresh-row / Refresh-cell),
    // cancel any prior active dispatches AND in-flight cells in scope before
    // clearing. Without this:
    //  - Two dispatcher loops would walk overlapping rows and burn duplicate work.
    //  - mode:'all' bulk-clear deletes in-flight sidecar rows without aborting
    //    workers — those would keep writing into the wiped state.
    // Scope: table-wide cancel when rowIds is empty (also cancels active
    // dispatches via markActiveDispatchesCancelled, sparing the one just
    // inserted above), per-row cancel otherwise (no dispatch cancel — other
    // rows' dispatches keep running). Dep-edit cascade in `updateRow` already
    // cancels its own scope before calling, so the duplicate work here is a
    // cheap no-op for that caller. Auto-fire (`mode:'new'`) is harmless
    // overlap-wise — the NOT EXISTS filter excludes already-attempted rows.
    const cancelPriorRuns = isManualRun && (mode === 'all' || mode === 'incomplete')
    if (cancelPriorRuns) {
      if (!rowIds || rowIds.length === 0) {
        // Filtered runs cancel only their own scope — a table-wide cancel here
        // would stop unrelated work on rows outside the filter (or on deselected rows).
        const cancelled = await cancelWorkflowGroupRuns(tableId, undefined, {
          groupIds: targetGroupIds,
          filter,
          excludeRowIds,
          spareDispatchId: dispatchId,
        })
        shouldSignalRowsChanged ||= cancelled > 0
      } else {
        // Per-row cancel — sequential so we don't fan out N parallel
        // markActiveDispatchesCancelled calls (it's a no-op when rowId is set,
        // but each call still touches the DB).
        for (const rowId of rowIds) {
          const cancelled = await cancelWorkflowGroupRuns(tableId, rowId, {
            groupIds: targetGroupIds,
          })
          shouldSignalRowsChanged ||= cancelled > 0
        }
      }
    }

    // Wipe targeted output cols + executions[gid] before any cells fire so the
    // user sees the column flip to empty/Pending instantly. Skipped for capped
    // runs: the eager clear can't know which N rows the dispatcher will pick
    // (they depend on per-row eligibility as it walks positions), so wiping all
    // rows in scope would blank far more than we re-run. `mode: 'all'` re-runs
    // completed cells without the clear anyway — the clear is only for instant
    // feedback, which the capped rows still get via the dispatcher's pre-stamp.
    // Skip the eager clear for a filtered run: `bulkClearWorkflowGroupCells` keys by `rowIds`, and a
    // filtered scope has none — clearing table-wide would blank rows that don't match the filter. The
    // dispatcher's per-row pre-stamp still provides instant Pending feedback as it walks.
    if (!limit && !filter) {
      const clearedRows = await bulkClearWorkflowGroupCells({
        tableId,
        workspaceId,
        groups: targetGroups.map((g) => ({ id: g.id, outputs: g.outputs })),
        rowIds,
        excludeRowIds,
        mode,
      })
      shouldSignalRowsChanged ||= clearedRows
    }
  } catch (err) {
    // Prep failed after the dispatch row was inserted — cancel it so an
    // orphaned `pending` dispatch can't pin the client's "about to run"
    // overlay, then fail the request with the ORIGINAL error. The cleanup is
    // best-effort: its own failure must not mask the prep failure.
    try {
      await cancelDispatchById(dispatchId)
    } catch (cleanupErr) {
      logger.error(`[Cascade] [${requestId}] failed to cancel dispatch after prep failure`, {
        dispatchId,
        error: toError(cleanupErr).message,
      })
    }
    throw err
  }

  // A Stop-all can land during the prep above; its dispatch cancel is the
  // authoritative stop. Don't fire the dispatcher loop for a dead dispatch —
  // it would exit on its first status read, but the trigger.dev path would
  // still spin up a task for nothing. Return a null dispatchId: the client
  // seeds a returned id into its active-dispatch overlay, which would
  // resurrect the Run/Stop UI the cancelled SSE event already cleared; null
  // takes its "no dispatch created" path and rolls the optimistic bump back.
  const current = await readDispatch(dispatchId)
  if (!current || current.status === 'cancelled' || current.status === 'complete') {
    logger.info(
      `[Cascade] [${requestId}] dispatch ${dispatchId} cancelled during prep — not firing`
    )
    return { dispatchId: null, shouldSignalRowsChanged }
  }

  logger.info(
    `[Cascade] [${requestId}] dispatch ${dispatchId} table=${tableId} groups=[${targetGroupIds.join(',')}] rows=${rowIds ? `[${rowIds.join(',')}]` : 'all'} mode=${mode}`
  )

  if (isTriggerDevEnabled) {
    // Trigger.dev runs `tableRunDispatcherTask`, which loops `dispatcherStep`
    // until done with CRIU-checkpointed waits between windows.
    const [{ tableRunDispatcherTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
      import('@/background/table-run-dispatcher'),
      import('@trigger.dev/sdk'),
      import('@/lib/core/async-jobs/region'),
    ])
    await tasks.trigger<typeof tableRunDispatcherTask>(
      'table-run-dispatcher',
      { dispatchId, concurrency },
      { concurrencyKey: dispatchId, region: await resolveTriggerRegion() }
    )
  } else {
    // Local / no-trigger.dev: drive the same loop in-process, fire-and-forget
    // so the HTTP request returns instantly (mirrors the trigger.dev path's
    // async fan-out).
    void runDispatcherToCompletion(dispatchId, concurrency).catch((err) =>
      logger.error(`[${requestId}] dispatcher loop failed`, {
        dispatchId,
        error: toError(err).message,
      })
    )
  }

  return { dispatchId, shouldSignalRowsChanged: true }
}

/**
 * Cell context stored on `paused_executions.metadata` so the resume worker
 * can route post-resume block outputs back to the same `(tableId, rowId,
 * groupId)` cell — i.e., one logical cell execution across pause/resume
 * cycles instead of two.
 */
export interface CellResumeContext {
  tableId: string
  tableName: string
  rowId: string
  groupId: string
  workspaceId: string
  workflowId: string
}

interface PausedMetadataPatch {
  cellContext?: CellResumeContext
  [key: string]: unknown
}

/**
 * Stash the cell context on the matching `paused_executions` row. Called
 * by the cell task right after it writes the `pending`/paused state. The
 * pause record was written by `PauseResumeManager.persistPauseResult`
 * before `executeWorkflow` returned, so the row exists.
 */
export async function stashCellContextForResume(
  ctx: CellResumeContext & { executionId: string }
): Promise<void> {
  const { executionId, ...cellContext } = ctx
  try {
    const patch: PausedMetadataPatch = { cellContext }
    await db
      .update(pausedExecutions)
      .set({
        metadata: sql`coalesce(${pausedExecutions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(pausedExecutions.executionId, executionId))
  } catch (err) {
    logger.error(
      `Failed to stash cell context on paused_executions (executionId=${executionId}):`,
      err
    )
  }
}

/**
 * Returns the cell context for an execution if one was stashed at pause
 * time. Used by the resume worker to know whether the workflow it's about
 * to resume belongs to a table cell — and if so, where to write outputs.
 */
export async function findCellContextByExecutionId(
  executionId: string
): Promise<CellResumeContext | null> {
  try {
    const [row] = await db
      .select({ metadata: pausedExecutions.metadata })
      .from(pausedExecutions)
      .where(eq(pausedExecutions.executionId, executionId))
      .limit(1)
    const meta = row?.metadata as PausedMetadataPatch | null
    return meta?.cellContext ?? null
  } catch (err) {
    logger.error(`Failed to read cell context for executionId=${executionId}:`, err)
    return null
  }
}

/** Throws if the schema has any invariant violations. Convenience for callers. */
