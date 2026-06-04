/**
 * Server-side scheduler for workflow-group auto-execution. The cascade is
 * driven entirely by the eligibility predicate: each row-write fires the
 * scheduler, which considers any newly-eligible (row × group) pair (deps
 * just filled, upstream group just `completed`) and enqueues per-cell jobs.
 */

import { db } from '@sim/db'
import { pausedExecutions, tableRowExecutions, type userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import { buildCancelledExecution } from '@/lib/table/cell-write'
import type {
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  TableDefinition,
  TableRow,
  TableSchema,
  WorkflowGroup,
} from '@/lib/table/types'

const logger = createLogger('WorkflowGroupScheduler')

import { areGroupDepsSatisfied, areOutputsFilled, isExecInFlight } from './deps'
import type { DispatchLimit, DispatchMode } from './dispatcher'

export {
  getUnmetGroupDeps,
  optimisticallyScheduleNewlyEligibleGroups,
} from './deps'

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
 *  trigger.dev to avoid a multi-second dispatcher cold-start. */
export async function buildEnqueueItems(
  pendingRuns: WorkflowGroupCellPayload[]
): Promise<Array<{ payload: WorkflowGroupCellPayload; options: EnqueueOptions }>> {
  const runner = isTriggerDevEnabled
    ? undefined
    : ((await import('@/background/workflow-column-execution'))
        .executeWorkflowGroupCellJob as EnqueueOptions['runner'])
  return pendingRuns.map((runOpts) => ({
    payload: runOpts,
    options: {
      metadata: {
        workflowId: runOpts.workflowId,
        workspaceId: runOpts.workspaceId,
        correlation: {
          executionId: runOpts.executionId,
          requestId: `wfgrp-${runOpts.executionId}`,
          source: 'workflow' as const,
          workflowId: runOpts.workflowId,
          triggerType: 'table',
        },
      },
      concurrencyKey: runOpts.tableId,
      concurrencyLimit: TABLE_CONCURRENCY_LIMIT,
      tags: cellTagsFor(runOpts),
      ...(runner ? { runner } : {}),
      cancelKey: cellCancelKey(runOpts.tableId, runOpts.rowId, runOpts.groupId),
    },
  }))
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
  const cancellations: Array<Promise<unknown>> = []
  try {
    // Trigger.dev paginates with auto-iterating cursor — looping the page
    // iterator is the documented usage pattern.
    for await (const run of runs.list({
      tag: tags,
      taskIdentifier: 'workflow-group-cell',
      status: ['PENDING_VERSION', 'QUEUED', 'DEQUEUED', 'EXECUTING', 'WAITING', 'DELAYED'],
    })) {
      cancellations.push(
        runs.cancel(run.id).catch((err) => {
          logger.warn(`cancelCellRunsByTags: cancel ${run.id} failed`, {
            error: toError(err).message,
          })
        })
      )
    }
    await Promise.allSettled(cancellations)
  } catch (err) {
    logger.warn(`cancelCellRunsByTags: list failed`, {
      tags,
      error: toError(err).message,
    })
  }
}

export function toTableRow(
  r: typeof userTableRows.$inferSelect,
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
  /** Owning dispatch, set by `dispatcherStep`. Lets the cell halt its dispatch
   *  on a hard stop (e.g. usage limit). Absent for cascade/auto-fire payloads
   *  that aren't driven by a dispatch. */
  dispatchId?: string
}

/** Per-table concurrency cap. Mirrors trigger.dev's `concurrencyLimit: 20`. */
export const TABLE_CONCURRENCY_LIMIT = 20

/**
 * Cancels in-flight workflow-group runs for a table or single row. Writes
 * `cancelled` authoritatively for every `running` or `pending` group
 * execution — the client-side write is the source of truth, independent of
 * whether the trigger.dev cancel reaches the worker before its terminal
 * write. Pass `groupIds` to restrict the cancel to a subset of groups on
 * the row (used by `updateRow` to cancel only the downstream groups whose
 * deps just changed).
 */
export async function cancelWorkflowGroupRuns(
  tableId: string,
  rowId?: string,
  options?: { groupIds?: string[] }
): Promise<number> {
  const { getTableById, updateRow } = await import('@/lib/table/service')
  const { getJobQueue } = await import('@/lib/core/async-jobs/config')
  const { listActiveDispatches, markActiveDispatchesCancelled } = await import('./dispatcher')

  const table = await getTableById(tableId)
  if (!table) {
    logger.warn(`cancelWorkflowGroupRuns: table ${tableId} not found`)
    return 0
  }

  // Per-row cancel leaves the dispatcher alone — other rows in the same
  // dispatch keep running. Table-wide cancel must stop it, else the cursor
  // marches on and re-enqueues fresh cells past what we just cancelled.
  if (!rowId) {
    await markActiveDispatchesCancelled(tableId)
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
  }
  const inFlightRows = await db
    .select()
    .from(tableRowExecutions)
    .where(and(...inFlightFilters))

  const queue = await getJobQueue()

  type RowMutation = {
    rowId: string
    executionsPatch: Record<string, RowExecutionMetadata>
    jobIds: string[]
    cancelledCount: number
  }
  const byRow = new Map<string, RowMutation>()

  for (const r of inFlightRows) {
    const prev: RowExecutionMetadata = {
      status: r.status as RowExecutionMetadata['status'],
      executionId: r.executionId ?? null,
      jobId: r.jobId ?? null,
      workflowId: r.workflowId,
      error: r.error ?? null,
      ...(r.blockErrors && Object.keys(r.blockErrors as Record<string, string>).length > 0
        ? { blockErrors: r.blockErrors as Record<string, string> }
        : {}),
    }
    const existing = byRow.get(r.rowId) ?? {
      rowId: r.rowId,
      executionsPatch: {},
      jobIds: [],
      cancelledCount: 0,
    }
    if (prev.jobId) existing.jobIds.push(prev.jobId)
    existing.executionsPatch[r.groupId] = buildCancelledExecution(prev)
    existing.cancelledCount++
    byRow.set(r.rowId, existing)
  }

  const mutations: RowMutation[] = Array.from(byRow.values())

  // Defense-in-depth for paused/awaiting cells: a cell that paused mid-run is
  // stamped `pending` with a `paused-<executionId>` jobId and keeps a record in
  // `paused_executions`. Mark those cancelling so a pending waitpoint short-
  // circuits before it resumes (the resume worker also re-checks the cell's
  // cancelled tombstone — that's the authoritative stop). No-op for cells with
  // no paused record.
  const pausedCancellations = inFlightRows
    .filter((r) => r.executionId && r.jobId?.startsWith('paused-'))
    .map((r) => ({ executionId: r.executionId as string, workflowId: r.workflowId }))
  if (pausedCancellations.length > 0) {
    const { PauseResumeManager } = await import(
      '@/lib/workflows/executor/human-in-the-loop-manager'
    )
    await Promise.allSettled(
      pausedCancellations.map((p) =>
        PauseResumeManager.beginPausedCancellation(p.executionId, p.workflowId).catch((err) => {
          logger.warn(`beginPausedCancellation failed for ${p.executionId}`, {
            error: toError(err).message,
          })
        })
      )
    )
  }

  // Abort in-flight cell runs. The interface method `cancelByKey` is a no-op
  // on the trigger.dev backend (no in-process AbortControllers) and aborts
  // the matching AbortController on the database backend. Trigger.dev's tag
  // sweep covers the SaaS path; the cell-write SQL guard is the
  // authoritative stop signal regardless of backend.
  for (const m of mutations) {
    for (const gid of Object.keys(m.executionsPatch)) {
      queue.cancelByKey(cellCancelKey(tableId, m.rowId, gid))
    }
  }
  const tagSweepPromise = isTriggerDevEnabled
    ? cancelCellRunsByTags(rowId ? [`rowId:${rowId}`] : [`tableId:${tableId}`])
    : Promise.resolve()
  await Promise.allSettled([
    ...mutations.flatMap((m) =>
      m.jobIds.map((jobId) =>
        queue.cancelJob(jobId).catch((err) => {
          logger.error(`Failed to cancel job ${jobId} for ${tableId}/${m.rowId}:`, err)
        })
      )
    ),
    tagSweepPromise,
  ])
  // `updateRow` no longer auto-fires the dispatcher post-write — the reactor
  // was removed. Cancel-writes only touch executions[gid] state; no risk of
  // re-enqueueing what we just cancelled.
  await Promise.allSettled(
    mutations.map((m) =>
      updateRow(
        {
          tableId,
          rowId: m.rowId,
          data: {},
          workspaceId: table.workspaceId,
          executionsPatch: m.executionsPatch,
        },
        table,
        `wfgrp-cancel-${m.rowId}`
      ).catch((err) => {
        logger.error(`Failed to write cancelled state for row ${m.rowId}:`, err)
      })
    )
  )

  // Tombstones for ahead-of-cursor groups. The in-flight cancel writes above
  // already cover groups that have a sidecar entry; we only need fresh
  // tombstones for groups that don't (the dispatcher hasn't reached them
  // yet, so there's nothing to cancel — but without a tombstone the
  // dispatcher would still re-fire when its cursor walks to this row).
  if (rowId && aheadOfCursorTombstones.length > 0) {
    const alreadyHandled = new Set(mutations.flatMap((m) => Object.keys(m.executionsPatch)))
    const needsTombstone = aheadOfCursorTombstones.filter((t) => !alreadyHandled.has(t.groupId))
    if (needsTombstone.length > 0) {
      const now = new Date()
      await Promise.allSettled(
        needsTombstone.map((t) =>
          db
            .insert(tableRowExecutions)
            .values({
              tableId,
              rowId,
              groupId: t.groupId,
              status: 'cancelled',
              executionId: null,
              jobId: null,
              workflowId: t.workflowId,
              error: 'Cancelled',
              runningBlockIds: [],
              blockErrors: {},
              cancelledAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({
              target: [tableRowExecutions.rowId, tableRowExecutions.groupId],
            })
            .catch((err) => {
              logger.error(`Failed to write tombstone for ${tableId}/${rowId}/${t.groupId}:`, err)
            })
        )
      )
    }
  }

  return mutations.reduce((sum, m) => sum + m.cancelledCount, 0)
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
  /** Optional cap on work before the dispatch completes (e.g. run only the
   *  first N eligible rows). Null/omitted = process every row in scope. */
  limit?: DispatchLimit | null
  /** When false, eligibility honors `autoRun: false` and treats completed
   *  cells as terminal — appropriate for auto-fire after row writes or
   *  schema changes. Defaults to true (user-initiated "Run column"). */
  isManualRun?: boolean
}): Promise<{ dispatchId: string | null }> {
  const { tableId, workspaceId, mode, requestId, groupIds, rowIds, limit } = opts
  const isManualRun = opts.isManualRun ?? true
  // Empty `rowIds` array means "scope explicitly empty" — auto-fire callers
  // (CSV import on zero matches, etc.) end up here. Skip the dispatch entirely
  // rather than walk the table with a no-match filter.
  if (rowIds && rowIds.length === 0) return { dispatchId: null }
  // Lazy imports: `./service` and `./dispatcher` both close cycles back to
  // this module; `@trigger.dev/sdk` is heavy and only needed on this op.
  const { getTableById } = await import('./service')
  const table = await getTableById(tableId)
  if (!table) throw new Error('Table not found')
  if (table.workspaceId !== workspaceId) throw new Error('Invalid workspace ID')

  const allGroups = table.schema.workflowGroups ?? []
  const targetGroups = groupIds ? allGroups.filter((g) => groupIds.includes(g.id)) : allGroups
  // Tables with no workflow groups are the majority. Auto-fire callers from
  // every row write would otherwise produce error-level log spam on every
  // PATCH/insert. Manual run-column callers always pass `groupIds` so they
  // can't reach here with an empty target.
  if (targetGroups.length === 0) return { dispatchId: null }
  const targetGroupIds = targetGroups.map((g) => g.id)

  const { bulkClearWorkflowGroupCells, insertDispatch, runDispatcherToCompletion } = await import(
    './dispatcher'
  )

  // For manual runs (Run all rows / Run column / Refresh-row / Refresh-cell),
  // cancel any prior active dispatches AND in-flight cells in scope before
  // clearing. Without this:
  //  - Two dispatcher loops would walk overlapping rows and burn duplicate work.
  //  - mode:'all' bulk-clear deletes in-flight sidecar rows without aborting
  //    workers — those would keep writing into the wiped state.
  // Scope: table-wide cancel when rowIds is empty (also cancels active
  // dispatches via markActiveDispatchesCancelled), per-row cancel otherwise
  // (no dispatch cancel — other rows' dispatches keep running). Dep-edit
  // cascade in `updateRow` already cancels its own scope before calling,
  // so the duplicate work here is a cheap no-op for that caller.
  // Auto-fire (`mode:'new'`) is harmless overlap-wise — the NOT EXISTS
  // filter excludes already-attempted rows.
  const cancelPriorRuns = isManualRun && (mode === 'all' || mode === 'incomplete')
  if (cancelPriorRuns) {
    if (!rowIds || rowIds.length === 0) {
      await cancelWorkflowGroupRuns(tableId, undefined, { groupIds: targetGroupIds })
    } else {
      // Per-row cancel — sequential so we don't fan out N parallel
      // markActiveDispatchesCancelled calls (it's a no-op when rowId is set,
      // but each call still touches the DB).
      for (const rowId of rowIds) {
        await cancelWorkflowGroupRuns(tableId, rowId, { groupIds: targetGroupIds })
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
  if (!limit) {
    await bulkClearWorkflowGroupCells({
      tableId,
      groups: targetGroups.map((g) => ({ id: g.id, outputs: g.outputs })),
      rowIds,
      mode,
    })
  }

  // Always insert a `table_run_dispatches` row. The dispatcher state machine
  // is the single source of truth for cursor advancement, SSE emission, and
  // cancel — backend (trigger.dev SaaS vs in-process) only affects how each
  // window's cells get executed.
  const dispatchId = await insertDispatch({
    tableId,
    workspaceId,
    requestId,
    mode,
    scope: {
      groupIds: targetGroupIds,
      ...(rowIds && rowIds.length > 0 ? { rowIds } : {}),
    },
    limit,
    isManualRun,
  })

  logger.info(
    `[Cascade] [${requestId}] dispatch ${dispatchId} table=${tableId} groups=[${targetGroupIds.join(',')}] rows=${rowIds ? `[${rowIds.join(',')}]` : 'all'} mode=${mode}`
  )

  if (isTriggerDevEnabled) {
    // Trigger.dev runs `tableRunDispatcherTask`, which loops `dispatcherStep`
    // until done with CRIU-checkpointed waits between windows.
    const [{ tableRunDispatcherTask }, { tasks }] = await Promise.all([
      import('@/background/table-run-dispatcher'),
      import('@trigger.dev/sdk'),
    ])
    await tasks.trigger<typeof tableRunDispatcherTask>(
      'table-run-dispatcher',
      { dispatchId },
      { concurrencyKey: dispatchId }
    )
  } else {
    // Local / no-trigger.dev: drive the same loop in-process, fire-and-forget
    // so the HTTP request returns instantly (mirrors the trigger.dev path's
    // async fan-out).
    void runDispatcherToCompletion(dispatchId).catch((err) =>
      logger.error(`[${requestId}] dispatcher loop failed`, {
        dispatchId,
        error: toError(err).message,
      })
    )
  }

  return { dispatchId }
}

// ───────────────────────────── Validation ─────────────────────────────

/**
/**
 * Removes the given column names from a group's `dependencies.columns` and from
 * its `inputMappings` (any mapping whose source `columnName` was removed). When
 * either list ends up empty, drops the field entirely so schema validation
 * doesn't see an empty object. Returns the same group reference when nothing
 * changed.
 */
export function stripGroupDeps(group: WorkflowGroup, removed: ReadonlySet<string>): WorkflowGroup {
  const cols = group.dependencies?.columns ?? []
  const mappings = group.inputMappings ?? []
  const filteredDeps = cols.filter((d) => !removed.has(d))
  const filteredMappings = mappings.filter((m) => !removed.has(m.columnName))
  const depsChanged = filteredDeps.length !== cols.length
  const mappingsChanged = filteredMappings.length !== mappings.length
  if (!depsChanged && !mappingsChanged) return group
  const next: WorkflowGroup = { ...group }
  if (depsChanged) {
    next.dependencies = filteredDeps.length > 0 ? { columns: filteredDeps } : undefined
  }
  if (mappingsChanged) {
    next.inputMappings = filteredMappings.length > 0 ? filteredMappings : undefined
  }
  return next
}

/**
 * Validates schema-level invariants. Run on every `addTableColumn`,
 * `addWorkflowGroup`, `updateWorkflowGroup`, `renameColumn`, `reorderColumns`,
 * etc. Returns a list of human-readable errors (empty if valid).
 */
export function validateSchema(schema: TableSchema, columnOrder: string[] | undefined): string[] {
  const errors: string[] = []
  const columnsByName = new Map(schema.columns.map((c) => [c.name, c]))
  const groups = schema.workflowGroups ?? []
  const groupsById = new Map(groups.map((g) => [g.id, g]))

  // Reference integrity for group outputs.
  const claimedColumns = new Map<string, string>() // columnName → groupId
  for (const group of groups) {
    if (group.outputs.length === 0) {
      errors.push(`Workflow group "${group.name ?? group.id}" has no outputs.`)
    }
    for (const out of group.outputs) {
      const col = columnsByName.get(out.columnName)
      if (!col) {
        errors.push(
          `Workflow group "${group.name ?? group.id}" references missing column "${out.columnName}".`
        )
        continue
      }
      if (col.workflowGroupId !== group.id) {
        errors.push(
          `Column "${col.name}" is referenced by group "${group.id}" but its workflowGroupId is "${col.workflowGroupId ?? '(unset)'}".`
        )
      }
      const claimer = claimedColumns.get(out.columnName)
      if (claimer && claimer !== group.id) {
        errors.push(
          `Column "${out.columnName}" is claimed by both groups "${claimer}" and "${group.id}".`
        )
      } else {
        claimedColumns.set(out.columnName, group.id)
      }
    }
  }

  // Every column flagged with a workflowGroupId must appear in exactly one group's outputs.
  for (const col of schema.columns) {
    if (!col.workflowGroupId) continue
    if (!groupsById.has(col.workflowGroupId)) {
      errors.push(
        `Column "${col.name}" references missing workflow group "${col.workflowGroupId}".`
      )
      continue
    }
    if (claimedColumns.get(col.name) !== col.workflowGroupId) {
      errors.push(
        `Column "${col.name}" has workflowGroupId "${col.workflowGroupId}" but isn't in that group's outputs.`
      )
    }
    if (col.required) {
      errors.push(`Workflow-output column "${col.name}" cannot be required.`)
    }
    if (col.unique) {
      errors.push(`Workflow-output column "${col.name}" cannot be unique.`)
    }
  }

  // Dependency integrity. Deps are columns only — workflow output columns are
  // valid deps too (the upstream group fills them, downstream becomes eligible
  // when filled). A group can't depend on its own outputs.
  for (const group of groups) {
    const ownOutputs = new Set(group.outputs.map((o) => o.columnName))
    for (const depCol of group.dependencies?.columns ?? []) {
      const col = columnsByName.get(depCol)
      if (!col) {
        errors.push(`Group "${group.name ?? group.id}" depends on missing column "${depCol}".`)
        continue
      }
      if (ownOutputs.has(depCol)) {
        errors.push(
          `Group "${group.name ?? group.id}" depends on its own output column "${depCol}".`
        )
      }
    }
  }

  // Cycle detection on the column-induced group graph. An edge A → B exists
  // when B depends on a column that A produces.
  const cycle = findGroupCycle(groups)
  if (cycle) {
    errors.push(
      `Workflow groups form a dependency cycle: ${cycle.map((id) => groupsById.get(id)?.name ?? id).join(' → ')}.`
    )
  }

  // Layout: every group's outputs must be contiguous in columnOrder (when set).
  if (columnOrder && columnOrder.length > 0) {
    for (const split of findSplitGroups(columnOrder, groups)) {
      errors.push(
        `Workflow group "${split.groupName}" output columns must be contiguous; got order [${split.actual.join(', ')}].`
      )
    }
  }

  return errors
}

/**
 * Returns the cycle as an ordered list of group ids, or null if acyclic. Edges
 * are induced by columns: an edge A → B exists iff B depends on a column that
 * A produces.
 */
function findGroupCycle(groups: WorkflowGroup[]): string[] | null {
  // Map each output column → the group that produces it.
  const producerByColumn = new Map<string, string>()
  for (const g of groups) {
    for (const o of g.outputs) producerByColumn.set(o.columnName, g.id)
  }
  const adjacency = new Map<string, string[]>()
  for (const g of groups) {
    const upstream = new Set<string>()
    for (const depCol of g.dependencies?.columns ?? []) {
      const producer = producerByColumn.get(depCol)
      if (producer && producer !== g.id) upstream.add(producer)
    }
    adjacency.set(g.id, [...upstream])
  }
  const VISITING = 1
  const VISITED = 2
  const state = new Map<string, number>()
  const stack: string[] = []

  const dfs = (id: string): string[] | null => {
    if (state.get(id) === VISITED) return null
    if (state.get(id) === VISITING) {
      const cycleStart = stack.indexOf(id)
      return cycleStart >= 0 ? [...stack.slice(cycleStart), id] : [id]
    }
    state.set(id, VISITING)
    stack.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const found = dfs(next)
      if (found) return found
    }
    stack.pop()
    state.set(id, VISITED)
    return null
  }

  for (const g of groups) {
    const cycle = dfs(g.id)
    if (cycle) return cycle
  }
  return null
}

interface SplitGroupReport {
  groupId: string
  groupName: string
  actual: number[]
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

/**
 * Returns groups whose output columns occupy non-contiguous positions in the
 * given columnOrder. Empty array means all groups are cohesive.
 */
export function findSplitGroups(
  columnOrder: string[],
  groups: WorkflowGroup[]
): SplitGroupReport[] {
  const positions = new Map<string, number>()
  columnOrder.forEach((name, idx) => positions.set(name, idx))
  const reports: SplitGroupReport[] = []
  for (const group of groups) {
    const indices = group.outputs
      .map((o) => positions.get(o.columnName))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b)
    if (indices.length < 2) continue
    const min = indices[0]
    const max = indices[indices.length - 1]
    if (max - min + 1 !== indices.length) {
      reports.push({
        groupId: group.id,
        groupName: group.name ?? group.id,
        actual: indices,
      })
    }
  }
  return reports
}

/** Throws if the schema has any invariant violations. Convenience for callers. */
export function assertValidSchema(schema: TableSchema, columnOrder: string[] | undefined): void {
  const errs = validateSchema(schema, columnOrder)
  if (errs.length > 0) {
    throw new Error(`Schema validation failed: ${errs.join('; ')}`)
  }
}
