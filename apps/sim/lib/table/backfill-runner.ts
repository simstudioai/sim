import { db } from '@sim/db'
import { tableRowExecutions, userTableRows, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getValueAtPath, isRecordLike } from '@sim/utils/object'
import { and, asc, count, eq, gt, inArray } from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  type FunctionalExecutionDataSource,
  getFunctionalBlockOutput,
} from '@/lib/logs/execution/functional-outputs'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { appendTableEvent } from '@/lib/table/events'
import {
  markJobFailed,
  markJobReady,
  markTableJobRunning,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import { createTableRowSecretProvenanceFromRegistry } from '@/lib/table/rows/secret-provenance'
import { batchUpdateRows } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import type {
  RowData,
  TableBackfillJobPayload,
  TableDefinition,
  WorkflowGroupOutput,
} from '@/lib/table/types'
import {
  isResolvedSecretTraceProvenanceV1,
  RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

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
  /**
   * Person whose permission group gates any cell the backfill's writes cascade
   * into. Separate from `actorUserId`, which is a billing attribution and names
   * the workspace billed account when the schema change carried no human. Null
   * when the change had no acting person.
   *
   * Absent only on a payload enqueued before this field existed and still
   * running after the deploy that added it — a backfill over more rows than
   * `BACKFILL_ASYNC_THRESHOLD_ROWS`, mid-flight at the cutover. Such a payload
   * reads as null, and that is a deliberate choice between two wrong answers
   * rather than the status quo: before this field, the cascaded cells gated on
   * `actorUserId`, so for a session-made change the window loosens the gate for
   * as long as that one job runs.
   *
   * Falling back to `actorUserId` would close that and open a worse one.
   * `attributedUserId` yields the workspace's billed account for a change made
   * by a workspace API key, and nothing on the payload distinguishes that id
   * from a human actor — so the fallback would apply a bystander's denylist,
   * which is the substitution this field exists to remove. Failing closed
   * instead would abandon the backfill's writes entirely, turning a bounded
   * governance edge into visible data loss on runs the schema change promised
   * to fill. Null is the least wrong of the three, and the window is one
   * deploy long.
   */
  capabilityGovernedUserId?: string | null
}

/**
 * Reconstructs the encrypted provenance checkpoint bound to one persisted
 * execution. Historical states without the contract, mismatched execution ids,
 * malformed envelopes, and undecryptable entries remain permanently unknown.
 */
export async function createBackfillExecutionSecretRegistry(options: {
  executionData: Record<string, unknown>
  executionId: string
  workspaceId: string
}): Promise<ResolvedSecretTraceRegistry> {
  const state = isRecordLike(options.executionData.executionState)
    ? options.executionData.executionState
    : undefined
  const provenance = state?.resolvedSecretTraceProvenance
  /**
   * A state persisted before the checkpoint contract carries no version at all. That is the bulk of
   * any backfill over historical rows, so it is separated from a checkpoint that exists but cannot
   * be used — only the latter is worth an error, and conflating them would put one line per legacy
   * row into the error stream.
   */
  const checkpointPresent =
    state?.resolvedSecretTraceCheckpointVersion === RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION
  const valid =
    checkpointPresent &&
    state?.sourceExecutionId === options.executionId &&
    isResolvedSecretTraceProvenanceV1(provenance) &&
    provenance.scope?.workspaceId === options.workspaceId
  const registry = new ResolvedSecretTraceRegistry([], valid ? provenance.scope : undefined)
  if (!valid) {
    registry.markIncomplete(
      checkpointPresent ? 'backfill-checkpoint-unusable' : 'backfill-checkpoint-absent'
    )
    return registry
  }
  await registry.importProvenance(provenance, {
    trusted: true,
    origin: 'tableBackfill.rowProvenance',
  })
  return registry
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
 * Backfills one page of rows: pulls each target output from the saved raw execution state
 * (materialized from object storage with bounded concurrency) and writes it into row data.
 * Returns the number of rows updated.
 */
async function processBackfillPage(opts: {
  table: TableDefinition
  outputs: WorkflowGroupOutput[]
  overwrite: boolean
  execs: Array<{ rowId: string; executionId: string | null }>
  requestId: string
  actorUserId?: string | null
  /** See {@link TableBackfillPayload.capabilityGovernedUserId}. */
  capabilityGovernedUserId?: string | null
}): Promise<number> {
  const { table, outputs, overwrite, execs, requestId, actorUserId, capabilityGovernedUserId } =
    opts

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

  const logByExecutionId = new Map<
    string,
    { data: FunctionalExecutionDataSource; registry: ResolvedSecretTraceRegistry }
  >()
  // Heavy execution data may live in object storage; resolve pointers (bounded concurrency).
  await mapWithConcurrency(logs, MATERIALIZE_CONCURRENCY, async (log) => {
    const executionData = await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId: log.workspaceId, workflowId: log.workflowId, executionId: log.executionId }
    )
    logByExecutionId.set(log.executionId, {
      data: executionData as FunctionalExecutionDataSource,
      registry: await createBackfillExecutionSecretRegistry({
        executionData,
        executionId: log.executionId,
        workspaceId: log.workspaceId,
      }),
    })
  })

  const updates: Array<{ rowId: string; data: RowData }> = []
  const secretProvenanceByRowId: NonNullable<
    Parameters<typeof batchUpdateRows>[0]['secretProvenanceByRowId']
  > = {}
  for (const r of rowRecords) {
    const execId = executionIdsByRow.get(r.id)
    if (!execId) continue
    const log = logByExecutionId.get(execId)
    if (!log) continue

    const dataPatch: RowData = {}
    let mutated = false
    for (const out of outputs) {
      if (!overwrite && (r.data as RowData)[out.columnName] !== undefined) continue
      const functionalOutput = getFunctionalBlockOutput(log.data, out.blockId)
      if (functionalOutput === undefined) continue
      const picked = getValueAtPath(functionalOutput, out.path)
      if (picked === undefined) continue
      dataPatch[out.columnName] = picked as RowData[string]
      mutated = true
    }
    if (!mutated) continue
    updates.push({ rowId: r.id, data: dataPatch })
    secretProvenanceByRowId[r.id] = createTableRowSecretProvenanceFromRegistry(
      dataPatch,
      log.registry
    )
  }

  if (updates.length === 0) return 0

  await batchUpdateRows(
    {
      tableId: table.id,
      updates,
      workspaceId: table.workspaceId,
      actorUserId,
      /**
       * A backfill replays values already produced by earlier runs, but the
       * cells it fills are dependencies: `batchUpdateRows` starts every
       * downstream group whose deps just became satisfied. Those cells are
       * governed by whoever made the schema change, carried separately from
       * `actorUserId` — an attribution that names the workspace billed account
       * when the change carried no human, whose denylist is nobody's to run.
       */
      capabilityGovernedUserId: capabilityGovernedUserId ?? null,
      secretProvenanceByRowId,
    },
    table,
    requestId,
    // Every patched key is a workflow-group output column, so a backfill is a
    // computed write and stays allowed on an update-locked table.
    { computedWrite: true }
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
  const { jobId, tableId, groupId, outputs, overwrite, actorUserId, capabilityGovernedUserId } =
    payload
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
        capabilityGovernedUserId,
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
  /** See {@link TableBackfillPayload.capabilityGovernedUserId}. */
  capabilityGovernedUserId?: string | null
}): Promise<void> {
  const { table, groupId, outputs, overwrite, requestId, actorUserId, capabilityGovernedUserId } =
    opts
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
      await processBackfillPage({
        table,
        outputs,
        overwrite,
        execs,
        requestId,
        actorUserId,
        capabilityGovernedUserId,
      })
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
    capabilityGovernedUserId,
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
