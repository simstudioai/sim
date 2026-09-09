import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { task, timeout } from '@trigger.dev/sdk'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  billingAttributionsEqual,
} from '@/lib/billing/core/billing-attribution'
import {
  capExecutionTimeoutMs,
  createTimeoutAbortController,
  ExecutionTimeoutError,
  getAsyncExecutionTimeoutForBillingAttribution,
  getTimeoutErrorMessage,
} from '@/lib/core/execution-limits'
import { withCascadeLock } from '@/lib/table/cascade-lock'
import type { WorkflowCellProgressWriter } from '@/lib/table/cell-write'
import { isExecCancelled } from '@/lib/table/deps'
import type { RowExecutionMetadata } from '@/lib/table/types'
import { classifyWorkflowCellTerminalResult } from '@/lib/table/workflow-cell-result'
import type { CellResumeContext } from '@/lib/table/workflow-columns'
import {
  createResumeAttemptTimeoutController,
  PauseResumeManager,
} from '@/lib/workflows/executor/human-in-the-loop-manager'
import { RESUME_EXECUTION_CONCURRENCY_LIMIT } from '@/background/concurrency-limits'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { SerializedSnapshot } from '@/executor/types'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('TriggerResumeExecution')

export type ResumeExecutionPayload = {
  resumeEntryId: string
  resumeExecutionId: string
  pausedExecutionId: string
  contextId: string
  resumeInput: unknown
  userId: string
  workflowId: string
  parentExecutionId: string
  /** Trusted attempt budget resolved before the resume enters the queue. */
  executionTimeoutMs?: number
  /** Immutable actor/payer decision captured before the resume enters the queue. */
  billingAttribution?: BillingAttributionSnapshot
}

export async function executeResumeJob(payload: ResumeExecutionPayload, signal?: AbortSignal) {
  const { resumeExecutionId, pausedExecutionId, contextId, workflowId, parentExecutionId } = payload

  logger.info('Starting background resume execution', {
    resumeExecutionId,
    pausedExecutionId,
    contextId,
    workflowId,
    parentExecutionId,
  })
  const payloadBillingAttribution = payload.billingAttribution
    ? assertBillingAttributionSnapshot(payload.billingAttribution)
    : undefined
  let timeoutController = payloadBillingAttribution
    ? createTimeoutAbortController(
        capExecutionTimeoutMs(
          getAsyncExecutionTimeoutForBillingAttribution(payloadBillingAttribution),
          payload.executionTimeoutMs
        ),
        signal
      )
    : payload.executionTimeoutMs === undefined
      ? undefined
      : createTimeoutAbortController(payload.executionTimeoutMs, signal)

  try {
    const pausedExecution = await PauseResumeManager.getPausedExecutionById(pausedExecutionId)
    if (!pausedExecution) {
      throw new Error(`Paused execution not found: ${pausedExecutionId}`)
    }
    const serializedSnapshot = pausedExecution.executionSnapshot as SerializedSnapshot
    if (!timeoutController) {
      timeoutController = createResumeAttemptTimeoutController(
        serializedSnapshot,
        signal,
        pausedExecution.metadata
      )
    }
    const attemptTimeoutController = timeoutController
    const attemptSignal = attemptTimeoutController.signal
    const persistedSnapshot = ExecutionSnapshot.fromJSON(serializedSnapshot.snapshot)
    const billingAttribution = assertBillingAttributionSnapshot(
      persistedSnapshot.metadata.billingAttribution
    )
    if (
      payloadBillingAttribution &&
      !billingAttributionsEqual(payloadBillingAttribution, billingAttribution)
    ) {
      throw new Error('Resume job billing attribution does not match the paused execution snapshot')
    }

    // If this paused execution belongs to a table cell, rehydrate the cell
    // context so post-resume block outputs land on the same row + group as
    // the original cell task. Without this, blocks that run after the human
    // approves write nothing back to the table — the row silently truncates
    // at the pause boundary.
    const { findCellContextByExecutionId } = await import('@/lib/table/workflow-columns')
    const cellContext = await findCellContextByExecutionId(parentExecutionId)

    // A paused/awaiting table cell that was cancelled by "Stop all" must not
    // resume — the cancel write is authoritative (matches the cell-write guard
    // philosophy). Aborting here also stops the wasted compute the guard alone
    // can't prevent. Read the cell's current exec and bail if cancelled.
    if (cellContext) {
      const { getRowById } = await import('@/lib/table/rows/service')
      const cellRow = await getRowById(
        cellContext.tableId,
        cellContext.rowId,
        cellContext.workspaceId
      )
      if (isExecCancelled(cellRow?.executions?.[cellContext.groupId])) {
        logger.info('Skipping resume — table cell cancelled', {
          tableId: cellContext.tableId,
          rowId: cellContext.rowId,
          groupId: cellContext.groupId,
          parentExecutionId,
        })
        return {
          success: false,
          workflowId,
          executionId: resumeExecutionId,
          parentExecutionId,
          status: 'cancelled' as const,
          output: undefined,
          executedAt: new Date().toISOString(),
        }
      }
    }

    const writers = cellContext
      ? await buildResumeCellWriters(cellContext, parentExecutionId)
      : null

    // No cell context → plain resume, no lock, no cascade continuation.
    if (!cellContext || !writers) {
      const result = await PauseResumeManager.startResumeExecution({
        resumeEntryId: payload.resumeEntryId,
        resumeExecutionId: payload.resumeExecutionId,
        pausedExecution,
        contextId: payload.contextId,
        resumeInput: payload.resumeInput,
        userId: payload.userId,
        abortSignal: attemptSignal,
      })
      logger.info('Background resume execution completed', {
        resumeExecutionId,
        workflowId,
        success: result.success,
        status: result.status,
      })
      throwIfResumeAttemptTimedOut(result.status, attemptTimeoutController)
      return {
        success: result.success,
        workflowId,
        executionId: resumeExecutionId,
        parentExecutionId,
        status: result.status,
        output: result.output,
        executedAt: new Date().toISOString(),
      }
    }

    // Cell-context path: hold the row's cascade lock for the resume + any
    // downstream cascade continuation. On lock contention, fall through to
    // resume-only (the lock holder will pick up the resumed group's
    // completion on its next eligibility scan).
    const outcome = await withCascadeLock(
      cellContext.tableId,
      cellContext.rowId,
      parentExecutionId,
      async () => {
        const result = await runResumeAndCellTerminal(
          payload,
          pausedExecution,
          writers,
          attemptSignal,
          attemptTimeoutController
        )
        if (result.status === 'paused' || result.status === 'cancelled') return result
        await continueCascadeAfterResume(cellContext, billingAttribution, attemptSignal)
        return result
      }
    )

    let result
    if (outcome.status === 'contended') {
      logger.info(
        `Resume cascade lock held — writing resumed group only (table=${cellContext.tableId} row=${cellContext.rowId} executionId=${parentExecutionId})`
      )
      result = await runResumeAndCellTerminal(
        payload,
        pausedExecution,
        writers,
        attemptSignal,
        attemptTimeoutController
      )
    } else {
      result = outcome.result
    }

    logger.info('Background resume execution completed', {
      resumeExecutionId,
      workflowId,
      success: result.success,
      status: result.status,
    })
    throwIfResumeAttemptTimedOut(result.status, attemptTimeoutController)

    return {
      success: result.success,
      workflowId,
      executionId: resumeExecutionId,
      parentExecutionId,
      status: result.status,
      output: result.output,
      executedAt: new Date().toISOString(),
    }
  } catch (error) {
    logger.error(
      'Background resume execution failed',
      projectResolvedSecretDiagnosticError(error, undefined, {
        resumeExecutionId,
        workflowId,
      })
    )
    throw error
  } finally {
    timeoutController?.cleanup()
  }
}

function throwIfResumeAttemptTimedOut(
  status: string | undefined,
  timeoutController: ReturnType<typeof createTimeoutAbortController>
): void {
  if (status !== 'cancelled' || !timeoutController.isTimedOut() || !timeoutController.timeoutMs) {
    return
  }

  throw new ExecutionTimeoutError(getTimeoutErrorMessage(null, timeoutController.timeoutMs))
}

type CellWriters = {
  cellOnBlockComplete: WorkflowCellProgressWriter['onBlockComplete']
  writeCellTerminal: (
    status: 'completed' | 'error' | 'cancelled' | 'paused',
    error: string | null
  ) => Promise<void>
}

async function buildResumeCellWriters(
  cellContext: {
    tableId: string
    rowId: string
    workspaceId: string
    groupId: string
    workflowId: string
  },
  parentExecutionId: string
): Promise<CellWriters | null> {
  const { getTableById } = await import('@/lib/table/service')
  const { buildCancelledExecution, createWorkflowCellProgressWriter, writeWorkflowGroupState } =
    await import('@/lib/table/cell-write')

  const table = await getTableById(cellContext.tableId)
  const group = table?.schema.workflowGroups?.find((g) => g.id === cellContext.groupId)
  if (!table || !group) {
    logger.warn('Cell context found but table or group missing — falling back to plain resume', {
      parentExecutionId,
      tableId: cellContext.tableId,
      groupId: cellContext.groupId,
    })
    return null
  }

  const writeCtx = {
    tableId: cellContext.tableId,
    rowId: cellContext.rowId,
    workspaceId: cellContext.workspaceId,
    groupId: cellContext.groupId,
    executionId: parentExecutionId,
    requestId: `wfgrp-resume-${parentExecutionId}`,
    table,
  }
  const progressWriter = createWorkflowCellProgressWriter({
    group,
    writeProgress: ({ dataPatch, eventOutputs, secretProvenance, blockErrors }) => {
      const partial: RowExecutionMetadata = {
        status: 'running',
        executionId: parentExecutionId,
        jobId: null,
        workflowId: cellContext.workflowId,
        error: null,
        blockErrors,
      }
      return writeWorkflowGroupState(writeCtx, {
        executionState: partial,
        dataPatch,
        eventOutputs,
        secretProvenance,
      })
    },
    onWriteError: (err) => {
      logger.warn(
        `Resume per-block partial write failed (table=${cellContext.tableId} row=${cellContext.rowId} group=${cellContext.groupId})`,
        projectResolvedSecretDiagnosticError(err, undefined)
      )
    },
  })

  const cellOnBlockComplete = progressWriter.onBlockComplete

  const writeCellTerminal = async (
    status: 'completed' | 'error' | 'cancelled' | 'paused',
    error: string | null
  ) => {
    await progressWriter.finish()
    const blockErrors = progressWriter.getBlockErrors()
    const terminal: RowExecutionMetadata =
      status === 'paused'
        ? {
            status: 'pending',
            executionId: parentExecutionId,
            jobId: `paused-${parentExecutionId}`,
            workflowId: cellContext.workflowId,
            error: null,
            blockErrors,
          }
        : status === 'cancelled'
          ? buildCancelledExecution({
              executionId: parentExecutionId,
              workflowId: cellContext.workflowId,
              blockErrors,
            })
          : {
              status,
              executionId: parentExecutionId,
              jobId: null,
              workflowId: cellContext.workflowId,
              error,
              runningBlockIds: [],
              blockErrors,
            }
    await writeWorkflowGroupState(writeCtx, {
      executionState: terminal,
      dataPatch: progressWriter.getPendingDataPatch(),
      eventOutputs: progressWriter.getEventOutputs(),
      secretProvenance: progressWriter.getPendingSecretProvenance(),
    })
  }

  return { cellOnBlockComplete, writeCellTerminal }
}

async function runResumeAndCellTerminal(
  payload: ResumeExecutionPayload,
  pausedExecution: Awaited<ReturnType<typeof PauseResumeManager.getPausedExecutionById>>,
  writers: CellWriters,
  signal: AbortSignal | undefined,
  timeoutController: ReturnType<typeof createTimeoutAbortController>
): Promise<Awaited<ReturnType<typeof PauseResumeManager.startResumeExecution>>> {
  if (!pausedExecution) throw new Error('Paused execution missing — already nulled by caller')
  const result = await PauseResumeManager.startResumeExecution({
    resumeEntryId: payload.resumeEntryId,
    resumeExecutionId: payload.resumeExecutionId,
    pausedExecution,
    contextId: payload.contextId,
    resumeInput: payload.resumeInput,
    userId: payload.userId,
    onBlockComplete: writers.cellOnBlockComplete,
    abortSignal: signal,
  })

  if (result.status === 'paused') {
    await writers.writeCellTerminal('paused', null)
  } else {
    const terminalResult = classifyWorkflowCellTerminalResult(result, {
      timedOut: timeoutController.isTimedOut(),
      timeoutMs: timeoutController.timeoutMs,
    })
    await writers.writeCellTerminal(terminalResult.status, terminalResult.error)
  }

  return result
}

async function continueCascadeAfterResume(
  cellContext: Pick<
    CellResumeContext,
    'tableId' | 'rowId' | 'workspaceId' | 'groupId' | 'capabilityGovernedUserId'
  >,
  billingAttribution: BillingAttributionSnapshot,
  signal?: AbortSignal
): Promise<void> {
  const { getTableById } = await import('@/lib/table/service')
  const { getRowById } = await import('@/lib/table/rows/service')
  const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')
  const { readStampedCapabilitySubject } = await import('@/lib/table/rows/executions')
  const { runRowCascadeLoop } = await import('@/background/workflow-column-execution')

  const freshTable = await getTableById(cellContext.tableId)
  if (!freshTable) return
  const freshRow = await getRowById(cellContext.tableId, cellContext.rowId, cellContext.workspaceId)
  if (!freshRow) return
  const next = pickNextEligibleGroupForRow(freshTable, freshRow, cellContext.groupId)
  if (!next) return
  const nextExec = freshRow.executions?.[next.id]
  const isQueuedMarker = nextExec?.status === 'pending' && nextExec.executionId == null
  await runRowCascadeLoop(
    {
      tableId: cellContext.tableId,
      tableName: freshTable.name,
      rowId: cellContext.rowId,
      workspaceId: cellContext.workspaceId,
      groupId: next.id,
      workflowId: next.workflowId,
      executionId: generateId(),
      billingAttribution,
      /**
       * The person who asked for the run that paused still gates the groups it
       * cascades into. Reconstructing this from the resume payload is not
       * possible — `payload.userId` is the resumer/attribution, not the gate —
       * so it rides the pause snapshot instead.
       *
       * Unless the next group carries another dispatch's unclaimed pre-stamp:
       * that is an explicit request from someone else that this cascade happens
       * to be draining, and it runs under the subject persisted with it. The
       * same decision both drain points in `workflow-column-execution.ts` make;
       * a resume that skipped it would hand a stranger's request the paused
       * cell's gate.
       */
      capabilityGovernedUserId: isQueuedMarker
        ? await readStampedCapabilitySubject(cellContext.rowId, next.id)
        : cellContext.capabilityGovernedUserId,
    },
    signal
  )
}

export const resumeExecutionTask = task({
  id: 'resume-execution',
  maxDuration: timeout.None,
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  queue: {
    concurrencyLimit: RESUME_EXECUTION_CONCURRENCY_LIMIT,
  },
  run: (payload: ResumeExecutionPayload, { signal }) => executeResumeJob(payload, signal),
})
