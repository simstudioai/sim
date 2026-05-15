/**
 * Server-side scheduler for workflow-group auto-execution. The cascade is
 * driven entirely by the eligibility predicate: each row-write fires the
 * scheduler, which considers any newly-eligible (row × group) pair (deps
 * just filled, upstream group just `completed`) and enqueues per-cell jobs.
 */

import { db } from '@sim/db'
import { pausedExecutions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getJobQueue } from '@/lib/core/async-jobs/config'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { buildCancelledExecution, writeWorkflowGroupState } from '@/lib/table/cell-write'
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
  | 'completed-on-incomplete'
  | 'manual-bypass'
  | 'deps-unmet'

export function classifyEligibility(
  group: WorkflowGroup,
  row: TableRow,
  opts?: { isManualRun?: boolean; mode?: 'all' | 'incomplete' }
): EligibilityReason {
  const isManualRun = opts?.isManualRun ?? false
  const mode = opts?.mode ?? 'all'

  if (group.autoRun === false && !isManualRun) return 'autoRun-off'

  const exec = row.executions?.[group.id]
  if (isExecInFlight(exec)) return 'in-flight'
  const status = exec?.status

  const completedAndFilled = status === 'completed' && areOutputsFilled(group, row)
  if (!isManualRun && completedAndFilled) return 'completed-on-auto'
  // Auto-fire skips `error` to avoid infinite-retry loops on a deterministic
  // failure. `cancelled` is left runnable — cancellation is user-initiated.
  if (!isManualRun && status === 'error') return 'error-on-auto'
  if (mode === 'incomplete' && completedAndFilled) return 'completed-on-incomplete'

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

/**
 * Shared options for the three `scheduleRuns*` entry points. `isManualRun`
 * flips two gates in the eligibility predicate so a manual click can re-run
 * terminal states and bypass the autoRun=false skip.
 */
export interface ScheduleOpts {
  groupId?: string
  groupIds?: string[]
  isManualRun?: boolean
  mode?: 'all' | 'incomplete'
}

/**
 * Re-evaluate eligibility on these specific rows and enqueue runnable cells.
 * The hot path: every row write (insert / update / cascade) calls this with the
 * just-written row(s).
 */
export async function scheduleRunsForRows(
  table: TableDefinition,
  rows: TableRow[],
  opts?: ScheduleOpts
): Promise<{ triggered: number }> {
  try {
    const allGroups = table.schema.workflowGroups ?? []
    if (allGroups.length === 0) return { triggered: 0 }
    if (rows.length === 0) return { triggered: 0 }

    const groupIdFilter = opts?.groupIds
      ? new Set(opts.groupIds)
      : opts?.groupId
        ? new Set([opts.groupId])
        : null
    const groups = groupIdFilter ? allGroups.filter((g) => groupIdFilter.has(g.id)) : allGroups
    if (groups.length === 0) return { triggered: 0 }

    const orderedRows = rows.length <= 1 ? rows : [...rows].sort((a, b) => a.position - b.position)

    const pendingRuns: RunGroupCellOptions[] = []
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
          workspaceId: table.workspaceId,
          executionId: generateId(),
        })
      }
    }

    logger.debug(
      `[Cascade] table=${table.id} rows=${rows.length} groups=${groups.length} manual=${opts?.isManualRun ?? false} mode=${opts?.mode ?? 'all'} reasons=${JSON.stringify(reasonCounts)}`
    )

    if (pendingRuns.length === 0) return { triggered: 0 }

    logger.info(`Scheduling ${pendingRuns.length} workflow group cell run(s) for table=${table.id}`)

    const queue = await getJobQueue()
    const { executeWorkflowGroupCellJob } = await import('@/background/workflow-column-execution')
    const items = pendingRuns.map((runOpts) => ({
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
        tags: [`tableId:${runOpts.tableId}`, `rowId:${runOpts.rowId}`, `group:${runOpts.groupId}`],
        runner: executeWorkflowGroupCellJob as EnqueueOptions['runner'],
      },
    }))

    let jobIds: string[]
    try {
      jobIds = await queue.batchEnqueue('workflow-group-cell', items)
    } catch (err) {
      logger.error(`Batch enqueue failed for table=${table.id}:`, err)
      await Promise.allSettled(
        pendingRuns.map((runOpts) =>
          writeWorkflowGroupState(runOpts, {
            executionState: {
              status: 'error',
              executionId: runOpts.executionId,
              jobId: null,
              workflowId: runOpts.workflowId,
              error: toError(err).message,
            },
          })
        )
      )
      return { triggered: 0 }
    }

    // Stamp `queued` in chunks of `TABLE_CONCURRENCY_LIMIT`. Within a chunk we
    // parallelize the writes (no ordering constraint); across chunks we await
    // serially so trigger.dev still picks rows up in submission order — the
    // concurrency cap means at most one chunk is in flight per table anyway.
    for (let i = 0; i < pendingRuns.length; i += TABLE_CONCURRENCY_LIMIT) {
      const chunk = pendingRuns.slice(i, i + TABLE_CONCURRENCY_LIMIT)
      const ids = jobIds.slice(i, i + TABLE_CONCURRENCY_LIMIT)
      await Promise.all(chunk.map((run, j) => stampQueuedOrCancel(queue, run, ids[j])))
    }
    return { triggered: pendingRuns.length }
  } catch (err) {
    logger.error('scheduleRunsForRows failed:', err)
    return { triggered: 0 }
  }
}

/**
 * Re-evaluate eligibility on every row of the table. Used after schema changes
 * (workflow group added, autoRun toggled on) where we don't have a list of
 * just-written rows but need to fire any newly-eligible (row × group) pair.
 */
export async function scheduleRunsForTable(
  table: TableDefinition,
  opts?: ScheduleOpts
): Promise<{ triggered: number }> {
  const rows = await fetchAllRows(table.id)
  return scheduleRunsForRows(table, rows, opts)
}

/**
 * Re-evaluate eligibility on the rows with these ids. Sugar for callers that
 * have row ids but not materialized rows.
 */
async function scheduleRunsForRowIds(
  table: TableDefinition,
  rowIds: string[],
  opts?: ScheduleOpts
): Promise<{ triggered: number }> {
  if (rowIds.length === 0) return { triggered: 0 }
  const rows = await fetchRowsByIds(table.id, rowIds)
  return scheduleRunsForRows(table, rows, opts)
}

async function fetchAllRows(tableId: string): Promise<TableRow[]> {
  const records = await db.select().from(userTableRows).where(eq(userTableRows.tableId, tableId))
  return records.map(toTableRow)
}

async function fetchRowsByIds(tableId: string, rowIds: string[]): Promise<TableRow[]> {
  const records = await db
    .select()
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), inArray(userTableRows.id, rowIds)))
  return records.map(toTableRow)
}

function toTableRow(r: typeof userTableRows.$inferSelect): TableRow {
  return {
    id: r.id,
    data: r.data as RowData,
    executions: (r.executions as RowExecutions) ?? {},
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

interface RunGroupCellOptions {
  tableId: string
  tableName: string
  rowId: string
  groupId: string
  workflowId: string
  workspaceId: string
  executionId: string
}

/** Per-table concurrency cap. Mirrors trigger.dev's `concurrencyLimit: 20`. */
const TABLE_CONCURRENCY_LIMIT = 20

async function stampQueuedOrCancel(
  queue: Awaited<ReturnType<typeof getJobQueue>>,
  opts: RunGroupCellOptions,
  jobId: string
): Promise<void> {
  let stampResult: 'wrote' | 'skipped' = 'wrote'
  try {
    stampResult = await writeWorkflowGroupState(opts, {
      executionState: {
        status: 'queued',
        executionId: opts.executionId,
        jobId,
        workflowId: opts.workflowId,
        error: null,
      },
    })
  } catch (err) {
    logger.error(
      `Failed to stamp queued state (table=${opts.tableId} row=${opts.rowId} group=${opts.groupId}):`,
      err
    )
  }

  if (stampResult === 'skipped') {
    try {
      await queue.cancelJob(jobId)
    } catch (cancelErr) {
      logger.error(`Failed to cancel orphaned workflow-group-cell job (jobId=${jobId}):`, cancelErr)
    }
  }
}

/**
 * Cancels in-flight workflow-group runs for a table or single row. Writes
 * `cancelled` authoritatively for every `running` or `pending` group
 * execution — the client-side write is the source of truth, independent of
 * whether the trigger.dev cancel reaches the worker before its terminal
 * write.
 */
export async function cancelWorkflowGroupRuns(tableId: string, rowId?: string): Promise<number> {
  const { getTableById, updateRow } = await import('@/lib/table/service')
  const { getJobQueue } = await import('@/lib/core/async-jobs/config')

  const table = await getTableById(tableId)
  if (!table) {
    logger.warn(`cancelWorkflowGroupRuns: table ${tableId} not found`)
    return 0
  }

  const groups = table.schema.workflowGroups ?? []
  if (groups.length === 0) return 0
  const groupIds = new Set(groups.map((g) => g.id))

  // Always filter by tableId — for the per-row case this prevents a
  // cross-table rowId from doing a wasted DB round-trip and silently
  // under-counting in the response. For the table-wide case it's the
  // primary filter.
  const rows = await db
    .select()
    .from(userTableRows)
    .where(
      rowId
        ? and(eq(userTableRows.id, rowId), eq(userTableRows.tableId, tableId))
        : eq(userTableRows.tableId, tableId)
    )

  const queue = await getJobQueue()

  type RowMutation = {
    rowId: string
    executionsPatch: Record<string, RowExecutionMetadata>
    jobIds: string[]
    cancelledCount: number
  }
  const mutations: RowMutation[] = []

  for (const row of rows) {
    const executions = (row.executions ?? {}) as RowExecutions
    const executionsPatch: Record<string, RowExecutionMetadata> = {}
    const jobIds: string[] = []
    let cancelledCount = 0
    for (const [gid, exec] of Object.entries(executions)) {
      if (!groupIds.has(gid)) continue
      // `pending` covers the post-reset, pre-dispatch window; `queued` covers
      // the post-enqueue, pre-pickup window — a stop click in either state
      // must still stick once the worker picks the row up.
      if (exec.status !== 'running' && exec.status !== 'queued' && exec.status !== 'pending')
        continue
      if (exec.jobId) jobIds.push(exec.jobId)
      executionsPatch[gid] = buildCancelledExecution(exec)
      cancelledCount++
    }
    if (cancelledCount > 0) {
      mutations.push({ rowId: row.id, executionsPatch, jobIds, cancelledCount })
    }
  }

  // Cancel jobs and write rows in parallel — no ordering dependency, so
  // serializing dozens-to-hundreds of rows per stop click is pure latency.
  await Promise.allSettled(
    mutations.flatMap((m) =>
      m.jobIds.map((jobId) =>
        queue.cancelJob(jobId).catch((err) => {
          logger.error(`Failed to cancel job ${jobId} for ${tableId}/${m.rowId}:`, err)
        })
      )
    )
  )
  // `skipScheduler: true` — we're tearing rows down, not waking them up. The
  // auto-fire reactor would otherwise see independent (row, group) pairs whose
  // deps are now satisfied (because the upstream group already wrote its
  // output before the cancel) and re-enqueue them, which is exactly what the
  // user clicked Stop to prevent.
  await Promise.allSettled(
    mutations.map((m) =>
      updateRow(
        {
          tableId,
          rowId: m.rowId,
          data: {},
          workspaceId: table.workspaceId,
          executionsPatch: m.executionsPatch,
          skipScheduler: true,
        },
        table,
        `wfgrp-cancel-${m.rowId}`
      ).catch((err) => {
        logger.error(`Failed to write cancelled state for row ${m.rowId}:`, err)
      })
    )
  )

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
  mode: 'all' | 'incomplete'
  requestId: string
  groupIds?: string[]
  rowIds?: string[]
}): Promise<{ triggered: number }> {
  const { tableId, workspaceId, mode, requestId, groupIds, rowIds } = opts
  const { getTableById, batchUpdateRows } = await import('./service')
  const table = await getTableById(tableId)
  if (!table) throw new Error('Table not found')
  if (table.workspaceId !== workspaceId) throw new Error('Invalid workspace ID')

  const allGroups = table.schema.workflowGroups ?? []
  const targetGroups = groupIds ? allGroups.filter((g) => groupIds.includes(g.id)) : allGroups
  if (targetGroups.length === 0) return { triggered: 0 }

  logger.info(
    `[Cascade] [${requestId}] manual run table=${tableId} groups=[${targetGroups.map((g) => g.id).join(',')}] rows=${rowIds ? `[${rowIds.join(',')}]` : 'all'} mode=${mode}`
  )

  const filters = [eq(userTableRows.tableId, tableId), eq(userTableRows.workspaceId, workspaceId)]
  if (rowIds && rowIds.length > 0) {
    filters.push(inArray(userTableRows.id, rowIds))
  }
  const candidateRows = await db
    .select({
      id: userTableRows.id,
      position: userTableRows.position,
      data: userTableRows.data,
      executions: userTableRows.executions,
      createdAt: userTableRows.createdAt,
      updatedAt: userTableRows.updatedAt,
    })
    .from(userTableRows)
    .where(and(...filters))
    .orderBy(asc(userTableRows.position))

  if (candidateRows.length === 0) return { triggered: 0 }

  // Per-row: collect eligible groups, build cleared data + executionsPatch.
  type Update = {
    rowId: string
    data: RowData
    executionsPatch: Record<string, null>
  }
  const updates: Update[] = []
  const clearedRows: TableRow[] = []
  for (const r of candidateRows) {
    const tableRow: TableRow = {
      id: r.id,
      data: r.data as RowData,
      executions: (r.executions as RowExecutions) ?? {},
      position: r.position,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }
    const eligibleGroups = targetGroups.filter((g) =>
      isGroupEligible(g, tableRow, { isManualRun: true, mode })
    )
    if (eligibleGroups.length === 0) continue

    const clearedData: RowData = {}
    const executionsPatch: Record<string, null> = {}
    for (const g of eligibleGroups) {
      for (const o of g.outputs) clearedData[o.columnName] = null
      executionsPatch[g.id] = null
    }
    updates.push({ rowId: r.id, data: clearedData, executionsPatch })

    const remainingExec = { ...tableRow.executions }
    for (const g of eligibleGroups) delete remainingExec[g.id]
    clearedRows.push({
      ...tableRow,
      data: { ...tableRow.data, ...clearedData },
      executions: remainingExec,
    })
  }

  if (updates.length === 0) return { triggered: 0 }

  // `skipScheduler: true` because we fire `scheduleRunsForRows` ourselves
  // below with `isManualRun: true`. Without the skip, batchUpdateRows runs the
  // auto-fire reactor first and any autoRun=true sibling group whose deps are
  // satisfied would race the manual call.
  await batchUpdateRows({ tableId, updates, workspaceId, skipScheduler: true }, table, requestId)

  return scheduleRunsForRows(table, clearedRows, {
    isManualRun: true,
    groupIds: targetGroups.map((g) => g.id),
    mode,
  })
}

// ───────────────────────────── Validation ─────────────────────────────

/**
/**
 * Removes the given column names from a group's `dependencies.columns`. When
 * the resulting list is empty, drops the `dependencies` field entirely so
 * schema validation doesn't see an empty-deps object. Returns the same group
 * reference when nothing changed.
 */
export function stripGroupDeps(group: WorkflowGroup, removed: ReadonlySet<string>): WorkflowGroup {
  const cols = group.dependencies?.columns
  if (!cols || cols.length === 0) return group
  const filtered = cols.filter((d) => !removed.has(d))
  if (filtered.length === cols.length) return group
  return {
    ...group,
    ...(filtered.length > 0
      ? { dependencies: { columns: filtered } }
      : { dependencies: undefined }),
  }
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
