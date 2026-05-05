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

import { areGroupDepsSatisfied } from './deps'

export {
  areGroupDepsSatisfied,
  getUnmetGroupDeps,
  optimisticallyScheduleNewlyEligibleGroups,
  type UnmetDeps,
} from './deps'

/**
 * Per-(row, group) eligibility for the **automatic** scheduler path. Skip
 * when the group has `autoRun: false` set (manual-only), when the group is
 * in flight (`queued`, `running`, or `pending` with a `jobId` already
 * stamped), or in a terminal state. Plain `pending` without a jobId is the
 * "ready to dispatch" state — the run route sets it and the scheduler is
 * what actually enqueues the job.
 *
 * The manual "Run all" path (`triggerWorkflowGroupRun`) uses
 * `areGroupDepsSatisfied` directly and bypasses this guard, so the user can
 * still kick off a run on a group that's set to manual-only.
 */
export function isGroupEligible(group: WorkflowGroup, row: TableRow): boolean {
  if (group.autoRun === false) return false
  const exec = row.executions?.[group.id]
  const status = exec?.status
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'error' ||
    status === 'cancelled'
  ) {
    return false
  }
  if (status === 'pending' && exec?.jobId) {
    return false
  }
  return areGroupDepsSatisfied(group, row)
}

/**
 * Iterates workflow groups × rows and enqueues eligible cell jobs. Safe to
 * call after any row-write; errors are logged. Concurrency is bounded by the
 * trigger.dev queue (`concurrencyKey: tableId`), so this just enqueues.
 */
export async function scheduleWorkflowGroupRuns(
  table: TableDefinition,
  rows: TableRow[]
): Promise<void> {
  try {
    const groups = table.schema.workflowGroups ?? []
    if (groups.length === 0) return
    if (rows.length === 0) return

    const orderedRows = rows.length <= 1 ? rows : [...rows].sort((a, b) => a.position - b.position)

    const pendingRuns: RunGroupCellOptions[] = []

    for (const row of orderedRows) {
      for (const group of groups) {
        if (!isGroupEligible(group, row)) continue
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

    if (pendingRuns.length === 0) return

    logger.info(`Scheduling ${pendingRuns.length} workflow group cell run(s) for table=${table.id}`)

    const queue = await getJobQueue()
    const { executeWorkflowGroupCellJob } = await import('@/background/workflow-column-execution')
    const items = pendingRuns.map((opts) => ({
      payload: opts,
      options: {
        metadata: {
          workflowId: opts.workflowId,
          workspaceId: opts.workspaceId,
          correlation: {
            executionId: opts.executionId,
            requestId: `wfgrp-${opts.executionId}`,
            source: 'workflow' as const,
            workflowId: opts.workflowId,
            triggerType: 'table',
          },
        },
        concurrencyKey: opts.tableId,
        concurrencyLimit: TABLE_CONCURRENCY_LIMIT,
        tags: [`tableId:${opts.tableId}`, `rowId:${opts.rowId}`, `group:${opts.groupId}`],
        runner: executeWorkflowGroupCellJob as EnqueueOptions['runner'],
      },
    }))

    let jobIds: string[]
    try {
      jobIds = await queue.batchEnqueue('workflow-group-cell', items)
    } catch (err) {
      logger.error(`Batch enqueue failed for table=${table.id}:`, err)
      await Promise.allSettled(
        pendingRuns.map((opts) =>
          writeWorkflowGroupState(opts, {
            executionState: {
              status: 'error',
              executionId: opts.executionId,
              jobId: null,
              workflowId: opts.workflowId,
              error: toError(err).message,
            },
          })
        )
      )
      return
    }

    for (let i = 0; i < pendingRuns.length; i++) {
      await stampQueuedOrCancel(queue, pendingRuns[i], jobIds[i])
    }
  } catch (err) {
    logger.error('scheduleWorkflowGroupRuns failed:', err)
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

/** Per-table concurrency cap. Mirrors trigger.dev's `concurrencyLimit: 10`. */
const TABLE_CONCURRENCY_LIMIT = 10

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

  return mutations.reduce((sum, m) => sum + m.cancelledCount, 0)
}

/**
 * Manually triggers a workflow group for every dep-satisfied row in a table.
 * `mode: 'all'` re-runs every eligible row; `mode: 'incomplete'` skips rows
 * whose group is already `completed`. When `rowIds` is provided, only those
 * rows are candidates — the same eligibility predicate still applies, so a
 * mid-run row or one with unmet deps is silently skipped. Eligible rows have
 * their output cells cleared and their `executions[groupId]` reset to
 * `pending`; the scheduler picks them up and enqueues per-cell jobs. Returns
 * the number of rows that were marked for re-run. Used by the
 * `groups/[groupId]/run` HTTP route and the Copilot/Mothership
 * `run_workflow_group` op so both share one eligibility predicate.
 */
export async function triggerWorkflowGroupRun(opts: {
  tableId: string
  groupId: string
  workspaceId: string
  mode: 'all' | 'incomplete'
  requestId: string
  rowIds?: string[]
}): Promise<{ triggered: number }> {
  const { tableId, groupId, workspaceId, mode, requestId, rowIds } = opts
  const { getTableById, batchUpdateRows } = await import('./service')
  const table = await getTableById(tableId)
  if (!table) throw new Error('Table not found')
  if (table.workspaceId !== workspaceId) throw new Error('Invalid workspace ID')

  const group = (table.schema.workflowGroups ?? []).find((g) => g.id === groupId)
  if (!group) throw new Error('Workflow group not found')

  // Push the in-flight / terminal-state filters into SQL so we don't pull
  // every row in the table into Node just to discard most of them. Dependency
  // satisfaction is still checked in JS afterwards (it can span multiple
  // columns and other groups' statuses, so it's awkward to express in JSONB).
  const filters = [
    eq(userTableRows.tableId, tableId),
    eq(userTableRows.workspaceId, workspaceId),
    sql`(executions->${groupId}->>'status') IS DISTINCT FROM 'running'`,
    sql`(executions->${groupId}->>'status') IS DISTINCT FROM 'queued'`,
    sql`((executions->${groupId}->>'status') IS DISTINCT FROM 'pending' OR (executions->${groupId}->>'jobId') IS NULL)`,
  ]
  if (rowIds && rowIds.length > 0) {
    filters.push(inArray(userTableRows.id, rowIds))
  }
  if (mode === 'incomplete') {
    filters.push(sql`(executions->${groupId}->>'status') IS DISTINCT FROM 'completed'`)
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

  const eligibleRows = candidateRows.filter((r) => {
    const tableRow: TableRow = {
      id: r.id,
      data: r.data as RowData,
      executions: (r.executions as RowExecutions) ?? {},
      position: r.position,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }
    try {
      return areGroupDepsSatisfied(group, tableRow)
    } catch {
      return false
    }
  })

  if (eligibleRows.length === 0) return { triggered: 0 }

  const clearedData = Object.fromEntries(group.outputs.map((o) => [o.columnName, null])) as RowData
  const updates = eligibleRows.map((r) => {
    const pendingExec: RowExecutionMetadata = {
      status: 'pending',
      executionId: generateId(),
      jobId: null,
      workflowId: group.workflowId,
      error: null,
    }
    return {
      rowId: r.id,
      data: clearedData,
      executionsPatch: { [groupId]: pendingExec },
    }
  })

  const opResult = await batchUpdateRows({ tableId, updates, workspaceId }, table, requestId)
  return { triggered: opResult.affectedCount }
}

// ───────────────────────────── Validation ─────────────────────────────

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

  // Dependency integrity.
  for (const group of groups) {
    const deps = group.dependencies ?? {}
    for (const depCol of deps.columns ?? []) {
      const col = columnsByName.get(depCol)
      if (!col) {
        errors.push(`Group "${group.name ?? group.id}" depends on missing column "${depCol}".`)
        continue
      }
      if (col.workflowGroupId) {
        errors.push(
          `Group "${group.name ?? group.id}" depends on workflow-output column "${depCol}". Depend on the producing group instead.`
        )
      }
    }
    for (const depGroup of deps.workflowGroups ?? []) {
      if (!groupsById.has(depGroup)) {
        errors.push(
          `Group "${group.name ?? group.id}" depends on missing workflow group "${depGroup}".`
        )
      }
      if (depGroup === group.id) {
        errors.push(`Group "${group.name ?? group.id}" depends on itself.`)
      }
    }
  }

  // Cycle detection on the group dependency graph.
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

/** Returns the cycle as an ordered list of group ids, or null if acyclic. */
function findGroupCycle(groups: WorkflowGroup[]): string[] | null {
  const adjacency = new Map<string, string[]>()
  for (const g of groups) {
    adjacency.set(g.id, g.dependencies?.workflowGroups ?? [])
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
