import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { withCascadeLock } from '@/lib/table/cascade-lock'
import { isExecCancelled } from '@/lib/table/deps'
import { appendTableEvent } from '@/lib/table/events'
import type {
  RowData,
  RowExecutionMetadata,
  TableDefinition,
  WorkflowGroup,
} from '@/lib/table/types'
import type { WorkflowGroupCellPayload } from '@/lib/table/workflow-columns'

export type { WorkflowGroupCellPayload }

const logger = createLogger('TriggerWorkflowGroupCell')

/** Max rate-limit retry attempts per cell before giving up and writing a
 *  re-runnable error. With `backoffWithJitter` (base 500ms, max 30s) this is
 *  ~1–2 minutes of pacing — enough to ride out a transient burst without
 *  stalling the dispatcher window indefinitely. */
const RATE_LIMIT_MAX_ATTEMPTS = 6

/** Cell-task entrypoint. Holds a per-row cascade lock so only one worker
 *  advances a given row at a time; bails on contention. The held lock heart-
 *  beats every 10s so a crashed pod releases within ~30s.
 *
 *  After the cascade finishes and the lock releases, re-checks for a runnable
 *  queued marker that may have landed between the cascade's final
 *  `pickNextEligibleGroupForRow` and the lock release (a window where a
 *  contender bails on the still-held lock but we're already done). If one
 *  appeared, re-acquire and drive it — this is the same task re-acquiring the
 *  lock, NOT a queue re-enqueue or a timed poll, and it loops only while a
 *  runnable group exists. */
export async function executeWorkflowGroupCellJob(
  payload: WorkflowGroupCellPayload,
  signal?: AbortSignal
) {
  const { tableId, rowId, workspaceId } = payload
  const { getTableById, getRowById } = await import('@/lib/table/service')
  const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')

  let currentPayload = payload
  while (true) {
    if (signal?.aborted) break
    const outcome = await withCascadeLock(tableId, rowId, currentPayload.executionId, () =>
      runRowCascadeLoop(currentPayload, signal)
    )
    if (outcome.status === 'contended') {
      // Another worker owns the row's cascade; it drains the queued marker.
      logger.info(
        `Cascade lock held — bailing (table=${tableId} row=${rowId} executionId=${currentPayload.executionId})`
      )
      break
    }
    // Usage limit hit mid-cascade: the dispatch is halted and no cell was
    // marked, so stop re-driving this row.
    if (outcome.result === 'blocked') break
    if (signal?.aborted) break
    const freshTable = await getTableById(tableId)
    if (!freshTable) break
    const freshRow = await getRowById(tableId, rowId, workspaceId)
    if (!freshRow) break
    const next = pickNextEligibleGroupForRow(freshTable, freshRow)
    if (!next) break
    // Only re-drive a genuine queued marker (an explicit run request whose
    // cell-task bailed during our release window). The inner cascade loop has
    // already drained every auto-eligible group, so re-driving a non-marker
    // group here would re-run forever — e.g. a group that completed with empty
    // outputs stays auto-eligible (the inner loop excludes it via
    // `excludeGroupId`, but this outer pass has no such anchor).
    const nextExec = freshRow.executions?.[next.id]
    const hasQueuedMarker = nextExec?.status === 'pending' && nextExec.executionId == null
    if (!hasQueuedMarker) break
    currentPayload = {
      ...currentPayload,
      groupId: next.id,
      workflowId: next.workflowId,
      // Re-derive so a workflow group after an enrichment group doesn't keep a stale enrichmentId.
      enrichmentId: next.enrichmentId,
      executionId: generateId(),
    }
  }
}

/** Re-fetches the table schema each iteration so groups added DURING the
 *  cascade become visible to the eligibility check. The resume worker must
 *  already hold the row's cascade lock before calling. */
export async function runRowCascadeLoop(
  payload: WorkflowGroupCellPayload,
  signal?: AbortSignal
): Promise<'blocked' | undefined> {
  const { tableId, rowId, workspaceId } = payload
  const { getTableById, getRowById } = await import('@/lib/table/service')
  const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')

  let currentGroupId = payload.groupId
  let currentWorkflowId = payload.workflowId
  // Fresh executionId per iteration: SQL guard rejects writes whose id ≠
  // row.executions[gid].executionId, so we need a new claim per group.
  let currentExecutionId = payload.executionId

  while (true) {
    if (signal?.aborted) break

    const freshTable = await getTableById(tableId)
    if (!freshTable) {
      logger.warn(`Table ${tableId} vanished mid-cascade`)
      break
    }
    const currentGroup = freshTable.schema.workflowGroups?.find((g) => g.id === currentGroupId)
    if (!currentGroup) {
      logger.warn(`Group ${currentGroupId} no longer exists on table ${tableId}`)
      break
    }

    const result = await runWorkflowAndWriteTerminal(
      {
        ...payload,
        groupId: currentGroupId,
        workflowId: currentWorkflowId,
        executionId: currentExecutionId,
      },
      signal,
      freshTable,
      currentGroup
    )

    if (result === 'paused') break
    // Hard stop (e.g. usage limit): the dispatch was halted and no cell was
    // marked. Propagate so the outer re-drive loop stops too — otherwise it
    // would re-pick the still-pending queued marker and spin.
    if (result === 'blocked') return 'blocked'

    const freshRow = await getRowById(tableId, rowId, workspaceId)
    if (!freshRow) break
    const next = pickNextEligibleGroupForRow(freshTable, freshRow, currentGroupId)
    if (!next) break
    currentGroupId = next.id
    currentWorkflowId = next.workflowId
    currentExecutionId = generateId()
  }
  return undefined
}

/** Returns `'paused'` to signal the cascade loop must exit (resume worker
 *  takes over) and `'blocked'` for a hard stop (usage limit — dispatch halted,
 *  cell left unmarked). `'completed' | 'error'` keep the loop running. */
async function runWorkflowAndWriteTerminal(
  payload: WorkflowGroupCellPayload,
  signal: AbortSignal | undefined,
  table: TableDefinition,
  group: WorkflowGroup
): Promise<'completed' | 'error' | 'paused' | 'blocked'> {
  const { tableId, tableName, rowId, groupId, workflowId, workspaceId, executionId, dispatchId } =
    payload
  // Read from the live `group`, not the payload: in a cascade the payload is the
  // first group's snapshot, so a downstream group with a different version must
  // use its own setting (same reason `workflowId` is re-derived per iteration).
  const deploymentMode = group.deploymentMode
  const requestId = `wfgrp-${executionId}`

  return runWithRequestContext({ requestId }, async () => {
    const { getRowById } = await import('@/lib/table/service')
    const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')
    const { loadWorkflowFromNormalizedTables, loadDeployedWorkflowState } = await import(
      '@/lib/workflows/persistence/utils'
    )
    const { writeWorkflowGroupState, markWorkflowGroupPickedUp, buildOutputsByBlockId } =
      await import('@/lib/table/cell-write')
    const { stashCellContextForResume } = await import('@/lib/table/workflow-columns')

    const cellCtx = { tableId, rowId, workspaceId, groupId, executionId, requestId }
    const writeState = (executionState: RowExecutionMetadata, dataPatch?: RowData) =>
      writeWorkflowGroupState(cellCtx, { executionState, dataPatch })

    /** Pre-execution cancellation guard: a cell cancelled while it sat in the
     *  queue (e.g. trigger.dev concurrency backlog) must not run once it
     *  dequeues. Reads the already-loaded row's exec — no extra query. */
    const cancelledBeforeRun = (exec: RowExecutionMetadata | undefined): boolean => {
      if (!isExecCancelled(exec)) return false
      logger.info(
        `Skipping cell — cancelled before execution (table=${tableId} row=${rowId} group=${groupId})`
      )
      return true
    }

    // Enrichment groups call a registry function directly instead of running a
    // workflow, reusing the same pickup → run → terminal-write status flow. The
    // `enrichmentId` guard ensures only true registry enrichments take this path
    // — a group typed 'enrichment' without a registry id falls through to the
    // workflow path rather than erroring.
    if (group.type === 'enrichment' && group.enrichmentId) {
      const { getEnrichment } = await import('@/enrichments/registry')
      const { runEnrichment } = await import('@/enrichments/run')
      const enrichment = getEnrichment(group.enrichmentId)
      // `tableRowExecutions.workflowId` is an opaque id for status; use the
      // enrichment id for enrichment cells.
      const statusId = group.enrichmentId ?? ''
      if (!enrichment) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId: statusId,
          error: `Unknown enrichment "${group.enrichmentId ?? ''}"`,
        })
        return 'error'
      }

      const row = await getRowById(tableId, rowId, workspaceId)
      if (!row) {
        logger.warn(`Row ${rowId} vanished before enrichment`)
        return 'error'
      }

      if (cancelledBeforeRun(row.executions?.[groupId])) return 'error'

      const pickedUp = await markWorkflowGroupPickedUp(cellCtx, {
        workflowId: statusId,
        jobId: null,
      })
      if (pickedUp === 'skipped') return 'error'

      // Map table columns → enrichment input ids (skip this group's own outputs).
      const ownOutputColumns = new Set(group.outputs.map((o) => o.columnName))
      const enrichInputs: Record<string, unknown> = {}
      for (const m of group.inputMappings ?? []) {
        if (ownOutputColumns.has(m.columnName)) continue
        enrichInputs[m.inputName] = row.data[m.columnName]
      }

      // Skip (don't error) rows missing a required input — common when a table
      // is partially filled. Clear any prior output values so a stale result
      // doesn't linger (and doesn't mark the group `completed`-and-filled, which
      // would block the auto cascade from re-enriching once inputs return).
      const isEmpty = (v: unknown) => v === undefined || v === null || v === ''
      const missingRequired = enrichment.inputs.some(
        (i) => i.required && isEmpty(enrichInputs[i.id])
      )
      if (missingRequired) {
        const clearPatch: RowData = {}
        for (const out of group.outputs) {
          if (!isEmpty(row.data[out.columnName])) clearPatch[out.columnName] = ''
        }
        await writeState(
          {
            status: 'completed',
            executionId,
            jobId: null,
            workflowId: statusId,
            error: null,
          },
          clearPatch
        )
        return 'completed'
      }

      try {
        if (signal?.aborted) {
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId: statusId,
            error: 'Cancelled',
          })
          return 'error'
        }
        const { result, cost, error } = await runEnrichment(enrichment, enrichInputs, {
          tableId,
          rowId,
          workspaceId,
          signal,
        })

        // An abort during the cascade must not be recorded as a completed cell.
        if (signal?.aborted) {
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId: statusId,
            error: 'Cancelled',
          })
          return 'error'
        }

        // Every provider that ran errored (auth / rate-limit / outage) — surface
        // it rather than writing a blank cell that looks like "no data found".
        if (error) {
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId: statusId,
            error,
          })
          return 'error'
        }

        // Bill the table owner for any hosted-key cost the providers incurred.
        // Billing failures must not error an otherwise-successful cell.
        if (cost > 0 && table.createdBy) {
          try {
            const { recordUsage } = await import('@/lib/billing/core/usage-log')
            await recordUsage({
              userId: table.createdBy,
              workspaceId,
              executionId,
              entries: [
                {
                  category: 'fixed',
                  source: 'enrichment',
                  description: enrichment.name,
                  cost,
                  sourceReference: `enrichment:${tableId}:${rowId}:${enrichment.id}`,
                  metadata: { enrichmentId: enrichment.id, tableId, rowId },
                },
              ],
            })
          } catch (billingErr) {
            logger.error('Failed to record enrichment usage', {
              enrichmentId: enrichment.id,
              cost,
              error: toError(billingErr).message,
            })
          }
        }

        // Write every output column: the result value when present, else clear
        // it. A partial/empty result must blank the columns it didn't fill so a
        // re-run that finds less than before doesn't leave stale values.
        const dataPatch: RowData = {}
        for (const out of group.outputs) {
          if (!out.outputId) continue
          const value = result[out.outputId]
          dataPatch[out.columnName] =
            value === undefined || value === null ? '' : (value as RowData[string])
        }
        await writeState(
          { status: 'completed', executionId, jobId: null, workflowId: statusId, error: null },
          dataPatch
        )
        return 'completed'
      } catch (err) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId: statusId,
          error: toError(err).message,
        })
        return 'error'
      }
    }

    const blockErrors: Record<string, string> = {}
    let writeChain: Promise<void> = Promise.resolve()
    let terminalWritten = false

    try {
      const [workflowRecord] = await db
        .select()
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: 'Workflow not found',
        })
        return 'error'
      }

      // `deployed` groups run the workflow's latest active deployment; `live`
      // (default) runs the editable draft. A `deployed` group whose workflow
      // has never been deployed fails the cell — no silent fallback to draft.
      let normalizedData: Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>
      if (deploymentMode === 'deployed') {
        try {
          normalizedData = await loadDeployedWorkflowState(workflowId, workspaceId)
        } catch (err) {
          // Surface the real reason (missing deployment vs. transient DB/migration
          // failure) rather than always claiming the workflow isn't deployed.
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId,
            error: toError(err).message,
          })
          return 'error'
        }
      } else {
        normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
      }
      const startBlock = normalizedData
        ? Object.values(normalizedData.blocks).find((b) => b?.type === 'start_trigger')
        : undefined
      if (!startBlock) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: 'Workflow is missing a Start trigger',
        })
        return 'error'
      }

      const row = await getRowById(tableId, rowId, workspaceId)
      if (!row) {
        logger.warn(`Row ${rowId} vanished before execution`)
        return 'error'
      }

      if (cancelledBeforeRun(row.executions?.[groupId])) return 'error'

      // Billing / usage / timeout gate — route table cells through the same
      // preprocessing every other trigger uses. Keep running draft
      // (checkDeployment: false). Rate limiting is paced separately below so a
      // retry doesn't re-run the (stable) billing/usage/subscription lookups.
      // Failures are surfaced via cell state / SSE / dispatch halt, so suppress
      // preprocessing's own execution-log writes.
      const preprocess = await preprocessExecution({
        workflowId,
        executionId,
        requestId,
        workspaceId,
        workflowRecord,
        userId: workflowRecord.userId,
        triggerType: 'workflow',
        checkDeployment: false,
        checkRateLimit: false,
        logPreprocessingErrors: false,
      })
      if (!preprocess.success) {
        // Usage/quota exhausted: retrying won't help. Halt the dispatch without
        // marking any cell, and signal the client to upgrade.
        if (preprocess.error?.statusCode === 402) {
          logger.warn(
            `Usage limit reached — halting dispatch (table=${tableId} row=${rowId} group=${groupId})`
          )
          // Don't leave the cell stuck on its `pending` pre-stamp. Clear this
          // cell's exec so it reverts to un-run (no error/cancelled badge —
          // matching "don't mark"; re-runnable after upgrade). Each blocked
          // cell clears its own.
          const { updateRow } = await import('@/lib/table/service')
          await updateRow(
            { tableId, rowId, data: {}, workspaceId, executionsPatch: { [groupId]: null } },
            table,
            requestId
          ).catch((err) =>
            logger.warn(`Failed to clear cell pre-stamp on usage limit`, {
              error: toError(err).message,
            })
          )
          // With up to 20 concurrent cells all hitting the limit at once, only
          // the cell that transitions the dispatch active→complete emits the
          // event — otherwise the user sees a toast per in-flight cell. Cells
          // with no owning dispatch (auto-fire) always emit.
          let shouldEmit = true
          if (dispatchId) {
            const { completeDispatchIfActive } = await import('@/lib/table/dispatcher')
            shouldEmit = await completeDispatchIfActive(dispatchId)
          }
          if (shouldEmit) {
            await appendTableEvent({
              kind: 'usageLimitReached',
              tableId,
              ...(dispatchId ? { dispatchId } : {}),
              message:
                preprocess.error?.message ??
                'Usage limit exceeded. Please upgrade your plan to continue.',
            })
          }
          return 'blocked'
        }
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: preprocess.error?.message ?? 'Workflow could not start',
        })
        return 'error'
      }

      const actorUserId = preprocess.actorUserId ?? workflowRecord.userId
      const asyncTimeoutMs = preprocess.executionTimeout?.async

      // Rate-limit pacing: tables count against the async counter (background
      // jobs). On a hit, wait & retry so the row still runs rather than being
      // skipped — only this cheap check repeats. The waiting cell holds its
      // concurrency slot, pacing the whole dispatch to the user's rate limit.
      const rateLimiter = new RateLimiter()
      for (let attempt = 1; ; attempt++) {
        if (signal?.aborted) return 'error'
        const rl = await rateLimiter.checkRateLimitWithSubscription(
          actorUserId,
          preprocess.userSubscription ?? null,
          'workflow',
          true
        )
        if (rl.allowed) break
        if (attempt >= RATE_LIMIT_MAX_ATTEMPTS) {
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId,
            error: 'Rate limit exceeded — please retry later',
          })
          return 'error'
        }
        // Exponential backoff WITH jitter — pass null, not the bucket's
        // resetAt. That reset time is shared across all waiters, and
        // backoffWithJitter clamps a non-null hint to a fixed value with no
        // jitter, so honoring it would wake all ~20 concurrent cells in
        // lockstep and stampede the bucket. Jittered backoff spreads retries.
        const waitMs = backoffWithJitter(attempt, null)
        logger.info(
          `Rate limited — waiting ${Math.round(waitMs)}ms before retry ${attempt + 1} (table=${tableId} row=${rowId} group=${groupId})`
        )
        await sleep(waitMs)
        // Stop All can land mid-wait. On the trigger.dev backend `signal` never
        // fires (cancelByKey is a no-op there), so re-check the DB tombstone and
        // release this concurrency slot promptly instead of sleeping out the
        // full retry budget.
        const refreshed = await getRowById(tableId, rowId, workspaceId)
        if (!refreshed || cancelledBeforeRun(refreshed.executions?.[groupId])) return 'error'
      }

      // SQL guard also rejects if a stop click stamped `cancelled` between this
      // check and pickup.
      const pickedUp = await markWorkflowGroupPickedUp(cellCtx, {
        workflowId,
        jobId: null,
      })
      if (pickedUp === 'skipped') return 'error'

      // Output columns produced by THIS group are skipped on input — they're
      // populated by the run we're starting. Other group's outputs ARE
      // included (they're plain primitives in `row.data` thanks to the
      // flattened schema).
      const ownOutputColumns = new Set(group.outputs.map((o) => o.columnName))
      const inputRow: Record<string, unknown> = {}
      for (const key of Object.keys(row.data)) {
        if (ownOutputColumns.has(key)) continue
        inputRow[key] = row.data[key]
      }

      const headers = table.schema.columns
        .filter((c) => !ownOutputColumns.has(c.name))
        .map((c) => c.name)

      // When the group has explicit input mappings, feed the workflow's
      // Start-block fields from the mapped columns (`inputName ← row[columnName]`).
      // Otherwise fall back to spreading every non-output column by name, so a
      // Start field still resolves when it matches a column name. `row`/`rawRow`
      // always carry the full row for downstream reference.
      const inputMappings = group.inputMappings ?? []
      const mappedInputs: Record<string, unknown> = {}
      for (const m of inputMappings) {
        mappedInputs[m.inputName] = inputRow[m.columnName]
      }

      const input = {
        ...(inputMappings.length > 0 ? mappedInputs : inputRow),
        row: inputRow,
        rawRow: inputRow,
        previousRow: null,
        changedColumns: [],
        rowId,
        headers,
        tableId,
        tableName,
        timestamp: new Date().toISOString(),
      }

      const { pluckByPath } = await import('@/lib/table/pluck')
      const outputsByBlockId = buildOutputsByBlockId(group)

      const accumulatedData: RowData = {}
      const runningBlockIds = new Set<string>()

      const schedulePartialWrite = () => {
        if (terminalWritten) return
        const dataSnapshot: RowData = { ...accumulatedData }
        const blockErrorsSnapshot = { ...blockErrors }
        const runningSnapshot = Array.from(runningBlockIds)
        writeChain = writeChain
          .then(async () => {
            if (signal?.aborted) return
            if (terminalWritten) return
            await writeState(
              {
                status: 'running',
                executionId,
                jobId: null,
                workflowId,
                error: null,
                runningBlockIds: runningSnapshot,
                blockErrors: blockErrorsSnapshot,
              },
              dataSnapshot
            )
          })
          .catch((err) => {
            logger.warn(
              `Per-block partial write failed (table=${tableId} row=${rowId} group=${groupId})`,
              { cause: describeError(err), retryable: isRetryableInfrastructureError(err) }
            )
          })
      }

      const onBlockStart = async (blockId: string): Promise<void> => {
        if (!outputsByBlockId.has(blockId)) return
        runningBlockIds.add(blockId)
        schedulePartialWrite()
      }

      const onBlockComplete = async (blockId: string, output: unknown): Promise<void> => {
        const outputs = outputsByBlockId.get(blockId)
        if (!outputs) return

        const blockResult =
          output && typeof output === 'object' && 'output' in (output as object)
            ? (output as { output: unknown }).output
            : output

        const blockErrorMessage =
          blockResult &&
          typeof blockResult === 'object' &&
          typeof (blockResult as { error?: unknown }).error === 'string'
            ? (blockResult as { error: string }).error
            : null

        if (blockErrorMessage) {
          blockErrors[blockId] = blockErrorMessage
        } else {
          for (const out of outputs) {
            const plucked = pluckByPath(blockResult, out.path)
            if (plucked === undefined) continue
            accumulatedData[out.columnName] = plucked as RowData[string]
          }
        }
        runningBlockIds.delete(blockId)
        schedulePartialWrite()
      }

      // Enforce the per-plan execution timeout (from preprocessing), combined
      // with the existing cancel signal so either a timeout or a Stop aborts.
      const timeoutController = createTimeoutAbortController(asyncTimeoutMs)
      const abortSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal

      let result: Awaited<ReturnType<typeof executeWorkflow>>
      try {
        result = await executeWorkflow(
          {
            id: workflowRecord.id,
            // Workflow owner — drives personal env-var resolution + ownership.
            userId: workflowRecord.userId,
            workspaceId: workflowRecord.workspaceId,
            variables: (workflowRecord.variables as Record<string, unknown> | null) ?? {},
          },
          requestId,
          input,
          // Billing/usage/rate actor — the workspace billed account.
          actorUserId,
          {
            enabled: true,
            executionMode: 'sync',
            workflowTriggerType: 'table',
            triggerBlockId: startBlock.id,
            // `deployed` groups execute the latest active deployment; everything
            // else runs the editable draft (the table default). Matches the
            // state loaded above for start-block / output-block resolution.
            useDraftState: deploymentMode !== 'deployed',
            abortSignal,
            onBlockStart,
            onBlockComplete,
          },
          executionId
        )
      } finally {
        timeoutController.cleanup()
      }

      terminalWritten = true
      await writeChain.catch(() => {})

      if (result.status === 'paused') {
        await writeState(
          {
            status: 'pending',
            executionId,
            jobId: `paused-${executionId}`,
            workflowId,
            error: null,
            runningBlockIds: [],
            blockErrors,
          },
          accumulatedData
        )
        await stashCellContextForResume({
          executionId,
          tableId,
          tableName,
          rowId,
          groupId,
          workflowId,
          workspaceId,
        })
        return 'paused'
      }

      await writeState(
        {
          status: result.success ? 'completed' : 'error',
          executionId,
          jobId: null,
          workflowId,
          error: result.success ? null : (result.error ?? 'Workflow execution failed'),
          runningBlockIds: [],
          blockErrors,
        },
        accumulatedData
      )
      return result.success ? 'completed' : 'error'
    } catch (err) {
      const message = toError(err).message
      logger.error(
        `Workflow group cell execution failed (table=${tableId} row=${rowId} group=${groupId})`,
        {
          error: message,
          executionId,
          cause: describeError(err),
          retryable: isRetryableInfrastructureError(err),
        }
      )
      terminalWritten = true
      await writeChain.catch(() => {})
      try {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: message,
          runningBlockIds: [],
          blockErrors,
        })
      } catch (writeErr) {
        logger.error('Also failed to write error state', {
          error: toError(writeErr).message,
          cause: describeError(writeErr),
          retryable: isRetryableInfrastructureError(writeErr),
        })
      }
      return 'error'
    }
  })
}

export const workflowGroupCellTask = task({
  id: 'workflow-group-cell',
  machine: 'medium-1x',
  retry: { maxAttempts: 1 },
  // Combined with `concurrencyKey: tableId`, caps each table's sub-queue to
  // 20 in-flight cell jobs while letting different tables run in parallel.
  queue: {
    name: 'workflow-group-cell',
    concurrencyLimit: 20,
  },
  run: (payload: WorkflowGroupCellPayload, { signal }) =>
    executeWorkflowGroupCellJob(payload, signal),
})
