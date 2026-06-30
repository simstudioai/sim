import { db } from '@sim/db'
import { tableRowExecutions, userTableRows, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, gt, inArray } from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { appendTableEvent } from '@/lib/table/events'
import {
  markJobFailed,
  markJobReady,
  markTableJobRunning,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import { pluckByPath } from '@/lib/table/pluck'
import { batchUpdateRows } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import type {
  RowData,
  TableBackfillJobPayload,
  TableDefinition,
  WorkflowGroupOutput,
} from '@/lib/table/types'

const logger = createLogger('TableBackfillRunner')

/** Completed-run count above which the backfill runs as a background job instead of inline. */
const BACKFILL_ASYNC_THRESHOLD_ROWS = 500

/** Completed sidecar rows fetched (and their logs materialized) per page. */
const BACKFILL_PAGE_SIZE = 200

/** Thrown when this worker loses the job (canceled / janitor-failed). */
class JobSupersededError extends Error {}

export interface TableBackfillPayload {
  jobId: string
  tableId: string
  workspaceId: string
  groupId: string
  outputs: WorkflowGroupOutput[]
  overwrite: boolean
  /** User who triggered the schema change, for usage attribution on the row writes. */
  actorUserId?: string | null
}

/** Minimal shape of a trace span we care about for backfill. */
interface BackfillTraceSpan {
  blockId?: string
  output?: Record<string, unknown>
  children?: BackfillTraceSpan[]
}

/** DFS the trace tree for the first span matching `blockId`. */
function findSpanByBlockId(
  spans: BackfillTraceSpan[] | undefined,
  blockId: string
): BackfillTraceSpan | undefined {
  if (!spans) return undefined
  for (const span of spans) {
    if (span.blockId === blockId) return span
    const child = findSpanByBlockId(span.children, blockId)
    if (child) return child
  }
  return undefined
}

/** One keyset page of completed (rowId, executionId) pairs for the group, ordered by rowId. */
async function selectCompletedExecPage(
  tableId: string,
  groupId: string,
  afterRowId: string | undefined,
  limit: number
): Promise<Array<{ rowId: string; executionId: string | null }>> {
  return db
    .select({
      rowId: tableRowExecutions.rowId,
      executionId: tableRowExecutions.executionId,
    })
    .from(tableRowExecutions)
    .where(
      and(
        eq(tableRowExecutions.tableId, tableId),
        eq(tableRowExecutions.groupId, groupId),
        eq(tableRowExecutions.status, 'completed'),
        afterRowId ? gt(tableRowExecutions.rowId, afterRowId) : undefined
      )
    )
    .orderBy(asc(tableRowExecutions.rowId))
    .limit(limit)
}

/**
 * Backfills one page of rows: pulls each target output's value out of the rows' saved trace
 * spans (materialized from object storage with bounded concurrency) and writes it into row data.
 * Returns the number of rows updated.
 */
async function processBackfillPage(opts: {
  table: TableDefinition
  outputs: WorkflowGroupOutput[]
  overwrite: boolean
  execs: Array<{ rowId: string; executionId: string | null }>
  requestId: string
  actorUserId?: string | null
}): Promise<number> {
  const { table, outputs, overwrite, execs, requestId, actorUserId } = opts

  const executionIdsByRow = new Map<string, string>()
  for (const e of execs) {
    if (!e.executionId) continue
    executionIdsByRow.set(e.rowId, e.executionId)
  }
  if (executionIdsByRow.size === 0) return 0

  const rowRecords = await db
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, table.id),
        inArray(userTableRows.id, Array.from(executionIdsByRow.keys()))
      )
    )

  const executionIds = Array.from(new Set(executionIdsByRow.values()))
  const logs = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.executionId, executionIds))

  const logByExecutionId = new Map<string, { traceSpans?: BackfillTraceSpan[] }>()
  // Heavy execution data may live in object storage; resolve pointers (bounded concurrency).
  await mapWithConcurrency(logs, MATERIALIZE_CONCURRENCY, async (log) => {
    const executionData = await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId: log.workspaceId, workflowId: log.workflowId, executionId: log.executionId }
    )
    logByExecutionId.set(
      log.executionId,
      (executionData as { traceSpans?: BackfillTraceSpan[] }) ?? {}
    )
  })

  const updates: Array<{ rowId: string; data: RowData }> = []
  for (const r of rowRecords) {
    const execId = executionIdsByRow.get(r.id)
    if (!execId) continue
    const log = logByExecutionId.get(execId)
    if (!log) continue

    const dataPatch: RowData = {}
    let mutated = false
    for (const out of outputs) {
      if (!overwrite && (r.data as RowData)[out.columnName] !== undefined) continue
      const span = findSpanByBlockId(log.traceSpans, out.blockId)
      if (!span?.output) continue
      const picked = pluckByPath(span.output, out.path)
      if (picked === undefined) continue
      dataPatch[out.columnName] = picked as RowData[string]
      mutated = true
    }
    if (!mutated) continue
    updates.push({ rowId: r.id, data: dataPatch })
  }

  if (updates.length === 0) return 0

  await batchUpdateRows(
    { tableId: table.id, updates, workspaceId: table.workspaceId, actorUserId },
    table,
    requestId
  )
  return updates.length
}

/**
 * Background worker for large output-column backfills. Pages the group's completed executions
 * (keyset by rowId), materializing logs and writing values page by page. Ownership-gated per
 * page; retry-safe (re-plucking the same spans writes the same values, and `overwrite: false`
 * passes skip already-filled cells).
 */
export async function runTableBackfill(payload: TableBackfillPayload): Promise<void> {
  const { jobId, tableId, groupId, outputs, overwrite, actorUserId } = payload
  const requestId = generateId().slice(0, 8)

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Backfill target table ${tableId} not found`)

    let processed = 0
    let updated = 0
    let afterRowId: string | undefined

    while (true) {
      const owns = await updateJobProgress(tableId, processed, jobId)
      if (!owns) throw new JobSupersededError()

      const execs = await selectCompletedExecPage(tableId, groupId, afterRowId, BACKFILL_PAGE_SIZE)
      if (execs.length === 0) break
      afterRowId = execs[execs.length - 1].rowId

      updated += await processBackfillPage({
        table,
        outputs,
        overwrite,
        execs,
        requestId,
        actorUserId,
      })
      processed += execs.length
    }

    await updateJobProgress(tableId, processed, jobId)
    const becameReady = await markJobReady(tableId, jobId)
    if (becameReady) {
      void appendTableEvent({
        kind: 'job',
        type: 'backfill',
        tableId,
        jobId,
        status: 'ready',
        progress: updated,
      })
      logger.info(`[${requestId}] Backfill complete`, { tableId, groupId, processed, updated })
    } else {
      logger.info(`[${requestId}] Backfill finished but no longer owns the run`, { tableId, jobId })
    }
  } catch (err) {
    if (err instanceof JobSupersededError) {
      logger.info(`[${requestId}] Backfill superseded/canceled; stopping`, { tableId, jobId })
    } else {
      const message = getErrorMessage(err, 'Backfill failed')
      logger.error(`[${requestId}] Backfill failed for table ${tableId}:`, err)
      await markJobFailed(tableId, jobId, message).catch(() => {})
      void appendTableEvent({
        kind: 'job',
        type: 'backfill',
        tableId,
        jobId,
        status: 'failed',
        error: message,
      })
    }
  }
}

/**
 * Hybrid entry the schema-change flows call after adding/remapping workflow outputs. Small
 * tables (≤ {@link BACKFILL_ASYNC_THRESHOLD_ROWS} completed runs) backfill inline-awaited, so the
 * response returns with row data already consistent — identical to the historical behavior. Above
 * the threshold, the work runs as a `table_jobs`-tracked background job (trigger.dev when
 * enabled). The job slot is shared with import/delete; if another job holds it, the backfill is
 * skipped with a warning — mirroring the long-standing "a failed backfill never fails the schema
 * change" posture (the data stays backfillable).
 */
export async function maybeBackfillGroupOutputs(opts: {
  table: TableDefinition
  groupId: string
  outputs: WorkflowGroupOutput[]
  overwrite: boolean
  requestId: string
  actorUserId?: string | null
}): Promise<void> {
  const { table, groupId, outputs, overwrite, requestId, actorUserId } = opts
  if (outputs.length === 0) return

  const [{ count: completedCount }] = await db
    .select({ count: count() })
    .from(tableRowExecutions)
    .where(
      and(
        eq(tableRowExecutions.tableId, table.id),
        eq(tableRowExecutions.groupId, groupId),
        eq(tableRowExecutions.status, 'completed')
      )
    )
  const total = Number(completedCount)
  if (total === 0) return

  if (total <= BACKFILL_ASYNC_THRESHOLD_ROWS) {
    // Inline: page without job machinery so memory stays bounded but the caller can await
    // full consistency.
    let afterRowId: string | undefined
    while (true) {
      const execs = await selectCompletedExecPage(table.id, groupId, afterRowId, BACKFILL_PAGE_SIZE)
      if (execs.length === 0) break
      afterRowId = execs[execs.length - 1].rowId
      await processBackfillPage({ table, outputs, overwrite, execs, requestId, actorUserId })
    }
    return
  }

  const jobId = generateId()
  const jobPayload: TableBackfillJobPayload = { groupId, outputs, overwrite }
  const claimed = await markTableJobRunning(table.id, jobId, 'backfill', jobPayload)
  if (!claimed) {
    logger.warn(
      `[${requestId}] Skipping backfill for table ${table.id} group ${groupId}: another job is running`
    )
    return
  }

  const payload: TableBackfillPayload = {
    jobId,
    tableId: table.id,
    workspaceId: table.workspaceId,
    groupId,
    outputs,
    overwrite,
    actorUserId,
  }
  if (isTriggerDevEnabled) {
    try {
      const [{ tableBackfillTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-backfill'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableBackfillTask>('table-backfill', payload, {
        tags: [`tableId:${table.id}`, `jobId:${jobId}`],
        region: await resolveTriggerRegion(),
      })
    } catch (error) {
      // Release the claim so a ghost `running` job doesn't block imports/deletes.
      // Swallowed (warn only): a failed backfill never fails the schema change —
      // the data stays backfillable.
      const { releaseJobClaim } = await import('@/lib/table/jobs/service')
      await releaseJobClaim(table.id, jobId).catch(() => {})
      logger.warn(
        `[${requestId}] Backfill dispatch failed for table ${table.id} group ${groupId}; skipping`,
        { error: getErrorMessage(error) }
      )
    }
  } else {
    runDetached('table-backfill', () => runTableBackfill(payload))
  }
}
