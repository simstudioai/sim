import { db } from '@sim/db'
import { tableRowExecutions, workflow as workflowTable } from '@sim/db/schema'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { task, timeout } from '@trigger.dev/sdk'
import { and, eq, isNull, or } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import {
  capExecutionTimeoutMs,
  createTimeoutAbortController,
  getAsyncExecutionTimeoutForBillingAttribution,
  getTimeoutErrorMessage,
  isTimeoutAbortReason,
  type TimeoutAbortController,
} from '@/lib/core/execution-limits'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { retryTableAdmission } from '@/lib/table/admission-retry'
import { withCascadeLock } from '@/lib/table/cascade-lock'
import { fillMissingColumns, mapInputValues, namedRowMapper } from '@/lib/table/cell-format'
import { getColumnId } from '@/lib/table/column-keys'
import { isEmptyCellValue, isExecCancelled } from '@/lib/table/deps'
import { getMaxTableDispatchConcurrency } from '@/lib/table/dispatch-concurrency'
import { appendTableEvent } from '@/lib/table/events'
import {
  createExactEmptyTableRowSecretProvenance,
  createTableRowSecretProvenanceFromRegistry,
  loadTableRowSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type {
  RowData,
  RowExecutionMetadata,
  TableDefinition,
  TableRowSecretProvenanceWrite,
  UpdateRowData,
  WorkflowGroup,
} from '@/lib/table/types'
import {
  buildWorkflowGroupExecutionCorrelation,
  type QueuedWorkflowGroupCellPayload,
  type WorkflowGroupCellPayload,
} from '@/lib/table/workflow-columns'
import { flattenWorkflowOutputs } from '@/lib/workflows/blocks/flatten-outputs'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import type { DeployedWorkflowData } from '@/lib/workflows/persistence/utils'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export type { WorkflowGroupCellPayload }

const logger = createLogger('TriggerWorkflowGroupCell')

/**
 * Fails before workflow execution when saved table mappings are incompatible
 * with the latest active deployment loaded for this cell run.
 */
export function assertWorkflowGroupMatchesLatestDeployment(
  group: WorkflowGroup,
  deployment: DeployedWorkflowData
): void {
  const validOutputs = new Set(
    flattenWorkflowOutputs(Object.values(deployment.blocks), deployment.edges).map(
      (output) => `${output.blockId}::${output.path}`
    )
  )
  const invalidOutput = group.outputs.find(
    (output) => !validOutputs.has(`${output.blockId}::${output.path}`)
  )
  if (invalidOutput) {
    throw new Error(
      `Workflow group ${group.id} output ${invalidOutput.blockId}::${invalidOutput.path} is not available in the latest active deployment`
    )
  }

  const startCandidate = TriggerUtils.findStartBlock(deployment.blocks, 'manual')
  if (!startCandidate) {
    throw new Error('Workflow is missing a Start trigger')
  }

  const validInputNames = new Set(
    normalizeInputFormatValue(startCandidate.block.subBlocks?.inputFormat?.value).map(
      (input) => input.name
    )
  )
  const invalidInput = (group.inputMappings ?? []).find(
    (mapping) => !validInputNames.has(mapping.inputName)
  )
  if (invalidInput) {
    throw new Error(
      `Workflow group ${group.id} input ${invalidInput.inputName} is not available in the latest active deployment`
    )
  }
}

function requirePayloadBillingAttribution(
  payload: WorkflowGroupCellPayload
): BillingAttributionSnapshot {
  if (!payload.billingAttribution) {
    throw new Error('Billing attribution is required for queued table execution')
  }
  const attribution = assertBillingAttributionSnapshot(payload.billingAttribution)
  if (attribution.workspaceId !== payload.workspaceId) {
    throw new Error(
      `Billing attribution workspace mismatch: expected ${payload.workspaceId}, received ${attribution.workspaceId}`
    )
  }
  if (payload.triggeredByUserId && attribution.actorUserId !== payload.triggeredByUserId) {
    throw new Error('Billing attribution actor does not match the table trigger actor')
  }
  return attribution
}

/** Max rate-limit retry attempts per cell before giving up and writing a
 *  re-runnable error. With `backoffWithJitter` (base 500ms, max 30s) this is
 *  ~1–2 minutes of pacing — enough to ride out a transient burst without
 *  stalling the dispatcher window indefinitely. */
const RATE_LIMIT_MAX_ATTEMPTS = 6

/**
 * Builds the execution-id-guarded terminal state used when a table attempt is
 * aborted. A user Stop has already persisted the
 * authoritative `cancelled` tombstone, which this error write cannot overwrite;
 * an uncorrelated backend abort still clears the pre-stamped pending state.
 */
export function buildTableAbortState(args: {
  executionId: string
  workflowId: string
  timedOut: boolean
  timeoutMs?: number
}): RowExecutionMetadata {
  const { executionId, workflowId, timedOut, timeoutMs } = args
  return {
    status: 'error',
    executionId,
    jobId: null,
    workflowId,
    error: timedOut ? getTimeoutErrorMessage(null, timeoutMs) : 'Cancelled',
    runningBlockIds: [],
  }
}

/**
 * Terminalizes only the unclaimed dispatcher marker owned by this carrier.
 * The conditional update cannot create a state for an auto-cascade group that
 * was never queued, or overwrite a cancellation/newer attempt.
 */
export async function terminalizeAbortedQueuedCarrierMarker(
  payload: QueuedWorkflowGroupCellPayload,
  signal: AbortSignal
): Promise<boolean> {
  const timeoutMs = capExecutionTimeoutMs(
    getAsyncExecutionTimeoutForBillingAttribution(requirePayloadBillingAttribution(payload)),
    payload.executionTimeoutMs
  )
  const executionState = buildTableAbortState({
    executionId: payload.executionId,
    workflowId: payload.enrichmentId ?? payload.workflowId,
    timedOut: isTimeoutAbortReason(signal.reason),
    timeoutMs,
  })
  const [updated] = await db
    .update(tableRowExecutions)
    .set({
      status: executionState.status,
      executionId: executionState.executionId,
      jobId: executionState.jobId,
      workflowId: executionState.workflowId,
      error: executionState.error,
      runningBlockIds: executionState.runningBlockIds,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tableRowExecutions.tableId, payload.tableId),
        eq(tableRowExecutions.rowId, payload.rowId),
        eq(tableRowExecutions.groupId, payload.groupId),
        eq(tableRowExecutions.status, 'pending'),
        or(
          isNull(tableRowExecutions.executionId),
          eq(tableRowExecutions.executionId, payload.executionId)
        )
      )
    )
    .returning({ rowId: tableRowExecutions.rowId })

  if (!updated) return false

  void appendTableEvent({
    kind: 'cell',
    tableId: payload.tableId,
    rowId: payload.rowId,
    groupId: payload.groupId,
    status: executionState.status,
    executionId: executionState.executionId ?? null,
    jobId: null,
    error: executionState.error ?? null,
  })
  return true
}

/** Builds the guarded null patch used to clear a usage-blocked cell pre-stamp. */
export function buildTableUsageLimitClear(args: {
  tableId: string
  rowId: string
  workspaceId: string
  groupId: string
  executionId: string
}): UpdateRowData {
  const { tableId, rowId, workspaceId, groupId, executionId } = args
  return {
    tableId,
    rowId,
    data: {},
    /** No cell values are written, so there is nothing to stamp. */
    secretProvenance: undefined,
    workspaceId,
    executionsPatch: { [groupId]: null },
    /** Clearing a pre-stamp writes no cell values and fires no enrichment. */
    capabilityGovernedUserId: null,
    cancellationGuard: { groupId, executionId },
  }
}

/** Starts the one active workflow deadline shared by every group in this carrier job. */
export function createWorkflowGroupCarrierTimeoutController(
  payload: QueuedWorkflowGroupCellPayload,
  parentSignal?: AbortSignal
): TimeoutAbortController {
  const billingAttribution = requirePayloadBillingAttribution(payload)
  return createTimeoutAbortController(
    capExecutionTimeoutMs(
      getAsyncExecutionTimeoutForBillingAttribution(billingAttribution),
      payload.executionTimeoutMs
    ),
    parentSignal
  )
}

/**
 * Owns cancellation for one workflow-group attempt without aborting the row
 * carrier that may subsequently execute other groups. The shared in-process
 * registry is an exact execution-id fast path; remote workers receive the same
 * exact cancellation through the executor's cancellation channel.
 */
export function createWorkflowGroupAttemptTimeoutController(
  payload: QueuedWorkflowGroupCellPayload,
  parentSignal?: AbortSignal
): TimeoutAbortController {
  const billingAttribution = requirePayloadBillingAttribution(payload)
  const controller = createTimeoutAbortController(
    capExecutionTimeoutMs(
      getAsyncExecutionTimeoutForBillingAttribution(billingAttribution),
      payload.executionTimeoutMs
    ),
    parentSignal
  )
  registerManualExecutionAborter(payload.executionId, controller.abort)

  return {
    ...controller,
    cleanup: () => {
      unregisterManualExecutionAborter(payload.executionId, controller.abort)
      controller.cleanup()
    },
  }
}

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
  payload: QueuedWorkflowGroupCellPayload,
  signal?: AbortSignal
) {
  const carrierTimeoutController = createWorkflowGroupCarrierTimeoutController(payload, signal)
  const carrierSignal = carrierTimeoutController.signal
  try {
    const { tableId, rowId, workspaceId } = payload
    const { getTableById } = await import('@/lib/table/service')
    const { getRowById } = await import('@/lib/table/rows/service')
    const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')
    const { readStampedCapabilitySubject } = await import('@/lib/table/rows/executions')

    let currentPayload = payload
    while (true) {
      if (carrierSignal.aborted) {
        await terminalizeAbortedQueuedCarrierMarker(currentPayload, carrierSignal)
        break
      }
      const outcome = await withCascadeLock(tableId, rowId, currentPayload.executionId, () =>
        runRowCascadeLoop(currentPayload, carrierSignal)
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
      if (carrierSignal.aborted) break
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
        /**
         * The marker was stamped by whichever dispatch requested THIS cell,
         * which is not necessarily the one that queued this carrier. Its gate
         * belongs to the person who asked for it, so take the subject off the
         * stamp rather than carrying our own into someone else's request.
         */
        capabilityGovernedUserId: await readStampedCapabilitySubject(rowId, next.id),
      }
    }
  } finally {
    carrierTimeoutController.cleanup()
  }
}

/** Re-fetches the table schema each iteration so groups added DURING the
 *  cascade become visible to the eligibility check. The resume worker must
 *  already hold the row's cascade lock before calling. */
export async function runRowCascadeLoop(
  payload: QueuedWorkflowGroupCellPayload,
  signal?: AbortSignal
): Promise<'blocked' | undefined> {
  const { tableId, rowId, workspaceId } = payload
  const { getTableById } = await import('@/lib/table/service')
  const { getRowById } = await import('@/lib/table/rows/service')
  const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')
  const { readStampedCapabilitySubject } = await import('@/lib/table/rows/executions')

  let currentGroupId = payload.groupId
  let currentWorkflowId = payload.workflowId
  // Fresh executionId per iteration: SQL guard rejects writes whose id ≠
  // row.executions[gid].executionId, so we need a new claim per group.
  let currentExecutionId = payload.executionId
  let currentCapabilityGovernedUserId = payload.capabilityGovernedUserId

  while (true) {
    if (signal?.aborted) {
      await terminalizeAbortedQueuedCarrierMarker(
        {
          ...payload,
          groupId: currentGroupId,
          workflowId: currentWorkflowId,
          executionId: currentExecutionId,
          capabilityGovernedUserId: currentCapabilityGovernedUserId,
        },
        signal
      )
      break
    }

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
        capabilityGovernedUserId: currentCapabilityGovernedUserId,
      },
      signal,
      freshTable,
      currentGroup
    )

    if (result === 'paused' || result === 'cancelled') break
    // Hard stop (e.g. usage limit): the dispatch was halted and no cell was
    // marked. Propagate so the outer re-drive loop stops too — otherwise it
    // would re-pick the still-pending queued marker and spin.
    if (result === 'blocked') return 'blocked'

    const freshRow = await getRowById(tableId, rowId, workspaceId)
    if (!freshRow) break
    const next = pickNextEligibleGroupForRow(freshTable, freshRow, currentGroupId)
    if (!next) break
    const nextExec = freshRow.executions?.[next.id]
    /**
     * A dep-fill cascade stays under the subject that started it. A group
     * carrying an unclaimed pre-stamp is a different thing — an explicit
     * request from another dispatch that this cascade is draining — so it runs
     * under the subject stamped with that request.
     */
    currentCapabilityGovernedUserId =
      nextExec?.status === 'pending' && nextExec.executionId == null
        ? await readStampedCapabilitySubject(rowId, next.id)
        : currentCapabilityGovernedUserId
    currentGroupId = next.id
    currentWorkflowId = next.workflowId
    currentExecutionId = generateId()
  }
  return undefined
}

/** Returns `'paused'` or `'cancelled'` when the cascade must exit and
 *  `'blocked'` for a hard stop (usage limit — dispatch halted, cell left
 *  unmarked). `'completed' | 'error'` keep the loop running. */
async function runWorkflowAndWriteTerminal(
  payload: QueuedWorkflowGroupCellPayload,
  signal: AbortSignal | undefined,
  table: TableDefinition,
  group: WorkflowGroup
): Promise<'completed' | 'error' | 'cancelled' | 'paused' | 'blocked'> {
  const { tableId, tableName, rowId, groupId, workflowId, workspaceId, executionId, dispatchId } =
    payload
  const billingAttribution = requirePayloadBillingAttribution(payload)
  const timeoutController = createWorkflowGroupAttemptTimeoutController(payload, signal)
  const attemptSignal = timeoutController.signal
  const requestId = `wfgrp-${executionId}`

  try {
    return await runWithRequestContext({ requestId }, async () => {
      const { getRowById } = await import('@/lib/table/rows/service')
      const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')
      const { loadDeployedWorkflowState } = await import('@/lib/workflows/persistence/utils')
      const {
        buildCancelledExecution,
        createWorkflowCellProgressWriter,
        writeWorkflowGroupState,
        markWorkflowGroupPickedUp,
      } = await import('@/lib/table/cell-write')
      const { classifyWorkflowCellTerminalResult } = await import(
        '@/lib/table/workflow-cell-result'
      )
      const { stashCellContextForResume } = await import('@/lib/table/workflow-columns')

      const cellCtx = { tableId, rowId, workspaceId, groupId, executionId, requestId, table }
      const writeState = (
        executionState: RowExecutionMetadata,
        dataPatch?: RowData,
        eventOutputs?: RowData,
        secretProvenance?: TableRowSecretProvenanceWrite
      ) =>
        writeWorkflowGroupState(cellCtx, {
          executionState,
          dataPatch,
          eventOutputs,
          secretProvenance,
        })

      /**
       * Dispatch-level cancellation guard.
       *
       * The dispatcher blocks on a whole window at a time, so cancelling its
       * `table_run_dispatches` row stops the NEXT window and nothing that is
       * already queued: those cells still invoke tools and write their results.
       * That gap is what account deletion falls into — it cancels the departing
       * account's dispatches and then deletes the user row, while the cells the
       * last window queued keep running under a subject that no longer exists.
       *
       * The row cannot be reached the other way: `table_row_executions` carries
       * no dispatch column, so there is nothing to cancel per cell. Reading the
       * owning dispatch here is the dispatch-linked stop, and it costs one
       * indexed primary-key read against a whole workflow run.
       *
       * `cancelled`, or a row that is gone — nothing deletes a dispatch but the
       * table cascade, so a missing one means the table it belonged to is gone.
       * `complete` deliberately does not stop the cell: it is the ordinary
       * terminal state a dispatch reaches while its last window is finishing.
       */
      if (dispatchId) {
        const { readDispatch } = await import('@/lib/table/dispatcher')
        const owningDispatch = await readDispatch(dispatchId)
        if (!owningDispatch || owningDispatch.status === 'cancelled') {
          logger.info(
            `Skipping cell — owning dispatch is cancelled (table=${tableId} row=${rowId} group=${groupId} dispatch=${dispatchId})`
          )
          await writeState(
            buildCancelledExecution({ executionId, workflowId, blockErrors: undefined })
          )
          return 'cancelled'
        }
      }

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
        const { runEnrichment, skippedEnrichmentDetail } = await import('@/enrichments/run')
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

        if (cancelledBeforeRun(row.executions?.[groupId])) return 'cancelled'

        const enrichmentBillingAttribution = billingAttribution

        /**
         * Gate the exact workspace payer and member cap before hosted-key cost.
         * A denial clears the cell pre-stamp and surfaces the upgrade state.
         */
        const usage = await checkAttributedUsageLimits(enrichmentBillingAttribution)
        if (usage.isExceeded) {
          logger.warn(
            `Usage limit reached — halting enrichment (table=${tableId} row=${rowId} group=${groupId})`
          )
          const { updateRow } = await import('@/lib/table/rows/service')
          await updateRow(
            buildTableUsageLimitClear({ tableId, rowId, workspaceId, groupId, executionId }),
            table,
            requestId
          ).catch((err) =>
            logger.warn(`Failed to clear cell pre-stamp on usage limit`, {
              error: toError(err).message,
            })
          )
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
                usage.message ?? 'Usage limit exceeded. Please upgrade your plan to continue.',
            })
          }
          return 'blocked'
        }

        const pickedUp = await markWorkflowGroupPickedUp(cellCtx, {
          workflowId: statusId,
          jobId: null,
        })
        if (pickedUp === 'skipped') return 'error'

        // Map table columns → enrichment input ids (skip this group's own outputs).
        // `columnName` holds a column id; the mapper resolves select ids to names.
        const ownOutputColumns = new Set(group.outputs.map((o) => o.columnName))
        const enrichmentInputMappings = (group.inputMappings ?? []).filter(
          (mapping) => !ownOutputColumns.has(mapping.columnName)
        )
        const enrichInputs = mapInputValues(row.data, table.schema.columns, enrichmentInputMappings)

        // Skip (don't error) rows missing a required input — common when a table
        // is partially filled. Clear any prior output values so a stale result
        // doesn't linger (and doesn't mark the group `completed`-and-filled, which
        // would block the auto cascade from re-enriching once inputs return).
        const isEmpty = isEmptyCellValue
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
              enrichmentDetails: skippedEnrichmentDetail(enrichment),
            },
            clearPatch,
            undefined,
            createExactEmptyTableRowSecretProvenance(clearPatch)
          )
          return 'completed'
        }

        try {
          if (attemptSignal.aborted) {
            await writeState({
              ...buildTableAbortState({
                executionId,
                workflowId: statusId,
                timedOut: timeoutController.isTimedOut(),
                timeoutMs: timeoutController.timeoutMs,
              }),
              enrichmentDetails: skippedEnrichmentDetail(enrichment, { aborted: true }),
            })
            return 'error'
          }
          const inputProvenance = await loadTableRowSecretProvenance(
            [
              {
                id: row.id,
                updatedAt: row.updatedAt,
                selectedValues: Object.fromEntries(
                  enrichmentInputMappings.map((mapping) => [
                    mapping.columnName,
                    row.data[mapping.columnName],
                  ])
                ),
              },
            ],
            { userId: enrichmentBillingAttribution.actorUserId, workspaceId }
          )
          const enrichmentRegistry = new ResolvedSecretTraceRegistry([], inputProvenance.scope)
          await enrichmentRegistry.importCrossingProvenance(inputProvenance, enrichInputs, {
            trusted: true,
          })
          const { result, cost, detail } = await runEnrichment(enrichment, enrichInputs, {
            tableId,
            rowId,
            workspaceId,
            /**
             * The person who asked, not who pays. `triggeredByUserId` is an
             * attribution: for a workspace-API-key run it names the workspace's
             * billing owner, and running that bystander's tool denylist against
             * an actorless request is wrong in both directions — it fails cells
             * nobody meant to govern, and it skips the denylist for the person
             * who actually triggered one. The governed subject is carried
             * separately from the dispatch. `null` means no per-tool gate
             * applies, which is the documented behavior for an actorless run —
             * stated, because the field is required precisely so it cannot be
             * skipped by omission.
             */
            userId: payload.capabilityGovernedUserId ?? null,
            signal: attemptSignal,
            resolvedSecretTraceRegistry: enrichmentRegistry,
          })

          // An abort during the cascade must not be recorded as a completed cell.
          if (attemptSignal.aborted) {
            await writeState({
              ...buildTableAbortState({
                executionId,
                workflowId: statusId,
                timedOut: timeoutController.isTimedOut(),
                timeoutMs: timeoutController.timeoutMs,
              }),
              enrichmentDetails: detail,
            })
            return 'error'
          }

          /**
           * Record the triggerer or system fallback as actor while charging the
           * exact workspace payer. Billing failures do not fail a successful cell.
           */
          if (cost > 0) {
            try {
              const { recordUsage } = await import('@/lib/billing/core/usage-log')
              await recordUsage({
                userId: enrichmentBillingAttribution.actorUserId,
                workspaceId,
                executionId,
                ...toBillingContext(enrichmentBillingAttribution),
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
              await checkAndBillPayerOverageThreshold(enrichmentBillingAttribution.billingEntity)
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
            {
              status: 'completed',
              executionId,
              jobId: null,
              workflowId: statusId,
              error: null,
              enrichmentDetails: detail,
            },
            dataPatch,
            undefined,
            createTableRowSecretProvenanceFromRegistry(dataPatch, enrichmentRegistry)
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

      let progressWriter: ReturnType<typeof createWorkflowCellProgressWriter> | null = null

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

        let normalizedData: Awaited<ReturnType<typeof loadDeployedWorkflowState>>
        try {
          normalizedData = await loadDeployedWorkflowState(workflowId, workspaceId)
          assertWorkflowGroupMatchesLatestDeployment(group, normalizedData)
        } catch (err) {
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId,
            error: toError(err).message,
          })
          return 'error'
        }
        const startCandidate = TriggerUtils.findStartBlock(normalizedData.blocks, 'manual')
        if (!startCandidate) {
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

        if (cancelledBeforeRun(row.executions?.[groupId])) return 'cancelled'

        // Billing / usage / timeout gate — route table cells through the same
        // preprocessing every other trigger uses. Keep running draft
        // (checkDeployment: false). Rate limiting is paced separately below so a
        // retry doesn't re-run the (stable) billing/usage/subscription lookups.
        // Failures are surfaced via cell state / SSE / dispatch halt, so suppress
        // preprocessing's own execution-log writes.
        // Attribute the run to the member who triggered it (manual run, row edit, or
        // auto-fire from their own write) so the gate + cost land on their per-member
        // meter — mirroring the enrichment branch. Falls back to the workspace billed
        // account for genuinely actor-less runs.
        const preprocess = await retryTableAdmission(
          () =>
            preprocessExecution({
              workflowId,
              executionId,
              requestId,
              workspaceId,
              workflowRecord,
              userId: payload.triggeredByUserId ?? workflowRecord.userId,
              useAuthenticatedUserAsActor: Boolean(payload.triggeredByUserId),
              // Falls back to the workflow owner when nobody triggered this.
              userIdIsStoredReference: !payload.triggeredByUserId,
              triggerType: 'workflow',
              checkDeployment: false,
              checkRateLimit: false,
              skipConcurrencyReservation: true,
              logPreprocessingErrors: false,
              billingAttribution,
              executionType: 'async',
            }),
          {
            signal: attemptSignal,
            onRetry: ({ attempt, failure, nextAttempt, waitMs }) => {
              logger.warn(
                `Transient admission failure — waiting ${waitMs}ms before retry ${nextAttempt} (table=${tableId} row=${rowId} group=${groupId})`,
                { attempt, failure: failure.kind }
              )
            },
          }
        )
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
            const { updateRow } = await import('@/lib/table/rows/service')
            await updateRow(
              buildTableUsageLimitClear({ tableId, rowId, workspaceId, groupId, executionId }),
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

        const writePacingAbortState = async (): Promise<'error'> => {
          await writeState(
            buildTableAbortState({
              executionId,
              workflowId,
              timedOut: timeoutController.isTimedOut(),
              timeoutMs: timeoutController.timeoutMs,
            })
          )
          return 'error'
        }

        // Rate-limit pacing: tables count against the async counter (background
        // jobs). On a hit, wait & retry so the row still runs rather than being
        // skipped — only this cheap check repeats. The waiting cell holds its
        // concurrency slot, pacing the whole dispatch to the user's rate limit.
        const rateLimiter = new RateLimiter()
        for (let attempt = 1; ; attempt++) {
          if (attemptSignal.aborted) return await writePacingAbortState()
          const rl = await rateLimiter.checkRateLimitWithSubscription(
            actorUserId,
            preprocess.actorSubscription ?? null,
            'workflow',
            true
          )
          if (attemptSignal.aborted) return await writePacingAbortState()
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
          if (attemptSignal.aborted) return await writePacingAbortState()
          // Stop All can land mid-wait. On the trigger.dev backend `signal` never
          // fires (cancelByKey is a no-op there), so re-check the DB tombstone and
          // release this concurrency slot promptly instead of sleeping out the
          // full retry budget.
          const refreshed = await getRowById(tableId, rowId, workspaceId)
          if (!refreshed || cancelledBeforeRun(refreshed.executions?.[groupId])) {
            return refreshed ? 'cancelled' : 'error'
          }
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
        // `inputRow` is name-keyed: the workflow author references columns by name
        // in the Start block and downstream blocks, while stored `row.data` is
        // id-keyed. Translate, skipping this group's own output columns.
        // NOTE: `outputs[].columnName` / `inputMappings[].columnName` hold column
        // **ids**, not names — a known misnomer (renaming it is a schema migration).
        const ownOutputColumnIds = new Set(group.outputs.map((o) => o.columnName))
        const inputColumns = table.schema.columns.filter(
          (c) => !ownOutputColumnIds.has(getColumnId(c))
        )
        // One column list drives both the row and its headers so they cannot drift.
        // The mapper also resolves select option ids to names — the workflow author
        // sees "Open", not `opt_a1b2`.
        const inputRow = fillMissingColumns(namedRowMapper(inputColumns)(row.data), inputColumns)
        const headers = inputColumns.map((c) => c.name)

        // When the group has explicit input mappings, feed the workflow's
        // Start-block fields from the mapped columns (`inputName ← row[columnId]`).
        // Otherwise fall back to spreading every non-output column by name, so a
        // Start field still resolves when it matches a column name. `row`/`rawRow`
        // always carry the full (name-keyed) row for downstream reference.
        const inputMappings = group.inputMappings ?? []
        const mappedInputs = mapInputValues(row.data, table.schema.columns, inputMappings)

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
        const rowInputProvenance = await loadTableRowSecretProvenance(
          [
            {
              id: row.id,
              updatedAt: row.updatedAt,
              selectedValues: Object.fromEntries(
                inputColumns.map((column) => {
                  const columnId = getColumnId(column)
                  return [columnId, row.data[columnId]]
                })
              ),
            },
          ],
          { userId: workflowRecord.userId, workspaceId }
        )
        const inputRegistry = new ResolvedSecretTraceRegistry([], rowInputProvenance.scope)
        await inputRegistry.importCrossingProvenance(rowInputProvenance, input, { trusted: true })

        progressWriter = createWorkflowCellProgressWriter({
          group,
          signal: attemptSignal,
          writeProgress: ({
            dataPatch,
            eventOutputs,
            secretProvenance,
            runningBlockIds,
            blockErrors,
          }) =>
            writeState(
              {
                status: 'running',
                executionId,
                jobId: null,
                workflowId,
                error: null,
                runningBlockIds,
                blockErrors,
              },
              dataPatch,
              eventOutputs,
              secretProvenance
            ),
          onWriteError: (err) => {
            logger.warn(
              `Per-block partial write failed (table=${tableId} row=${rowId} group=${groupId})`,
              { cause: describeError(err), retryable: isRetryableInfrastructureError(err) }
            )
          },
        })

        const result: Awaited<ReturnType<typeof executeWorkflow>> = await executeWorkflow(
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
            principal: {
              kind: 'system',
              serviceId: 'table',
              workspaceId,
              workflowId,
            },
            executionMode: 'sync',
            workflowTriggerType: 'table',
            triggerBlockId: startCandidate.blockId,
            useDraftState: false,
            workflowStateOverride: normalizedData,
            abortSignal: attemptSignal,
            onBlockStart: progressWriter.onBlockStart,
            onBlockComplete: progressWriter.onBlockComplete,
            trustedInitialResolvedSecretTraceProvenance: inputRegistry.exportCheckpointProvenance(),
            billingAttribution: preprocess.billingAttribution,
            trustedExecutionCorrelation: buildWorkflowGroupExecutionCorrelation(payload),
          },
          executionId
        )

        await progressWriter.finish()
        const eventOutputs = progressWriter.getEventOutputs()
        const pendingDataPatch = progressWriter.getPendingDataPatch()
        const blockErrors = progressWriter.getBlockErrors()

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
            pendingDataPatch,
            eventOutputs,
            progressWriter.getPendingSecretProvenance()
          )
          await stashCellContextForResume({
            executionId,
            tableId,
            tableName,
            rowId,
            groupId,
            workflowId,
            workspaceId,
            /**
             * The gate has to survive the pause. Nothing downstream of a resume
             * can re-derive it: the marker this cell was stamped with is long
             * claimed, and the resume worker's own payload has no dispatch.
             */
            capabilityGovernedUserId: payload.capabilityGovernedUserId,
          })
          return 'paused'
        }

        const terminalResult = classifyWorkflowCellTerminalResult(result, {
          timedOut: timeoutController.isTimedOut(),
          timeoutMs: timeoutController.timeoutMs,
        })
        const terminalState =
          terminalResult.status === 'cancelled'
            ? buildCancelledExecution({ executionId, workflowId, blockErrors })
            : {
                status: terminalResult.status,
                executionId,
                jobId: null,
                workflowId,
                error: terminalResult.error,
                runningBlockIds: [],
                blockErrors,
              }
        await writeState(
          terminalState,
          pendingDataPatch,
          eventOutputs,
          progressWriter.getPendingSecretProvenance()
        )
        return terminalResult.status
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
        await progressWriter?.finish()
        try {
          await writeState({
            status: 'error',
            executionId,
            jobId: null,
            workflowId,
            error: message,
            runningBlockIds: [],
            blockErrors: progressWriter?.getBlockErrors() ?? {},
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
  } finally {
    timeoutController.cleanup()
  }
}

export const workflowGroupCellTask = task({
  id: 'workflow-group-cell',
  maxDuration: timeout.None,
  machine: 'medium-1x',
  retry: { maxAttempts: 1 },
  // Combined with `concurrencyKey: tableId`, caps each table's sub-queue of
  // in-flight cell jobs while letting different tables run in parallel. The
  // cap is the highest per-plan dispatch window so the queue never throttles
  // below a plan's window — the dispatcher window is the real per-run limiter.
  // Read at trigger.dev deploy time: raising a TABLE_DISPATCH_CONCURRENCY_*
  // env var above the current max needs a trigger.dev redeploy to take effect.
  queue: {
    name: 'workflow-group-cell',
    concurrencyLimit: getMaxTableDispatchConcurrency(),
  },
  run: (payload: QueuedWorkflowGroupCellPayload, { signal }) =>
    executeWorkflowGroupCellJob(payload, signal),
})
