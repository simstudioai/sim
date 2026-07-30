import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { task } from '@trigger.dev/sdk'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { withCascadeLock } from '@/lib/table/cascade-lock'
import { isExecCancelled } from '@/lib/table/deps'
import type { RowExecutionMetadata } from '@/lib/table/types'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { RESUME_EXECUTION_CONCURRENCY_LIMIT } from '@/background/concurrency-limits'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { SerializedSnapshot } from '@/executor/types'

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
}

export async function executeResumeJob(payload: ResumeExecutionPayload) {
  const { resumeExecutionId, pausedExecutionId, contextId, workflowId, parentExecutionId } = payload

  logger.info('Starting background resume execution', {
    resumeExecutionId,
    pausedExecutionId,
    contextId,
    workflowId,
    parentExecutionId,
  })

  try {
    const pausedExecution = await PauseResumeManager.getPausedExecutionById(pausedExecutionId)
    if (!pausedExecution) {
      throw new Error(`Paused execution not found: ${pausedExecutionId}`)
    }
    const serializedSnapshot = pausedExecution.executionSnapshot as SerializedSnapshot
    const persistedSnapshot = ExecutionSnapshot.fromJSON(serializedSnapshot.snapshot)
    const billingAttribution = assertBillingAttributionSnapshot(
      persistedSnapshot.metadata.billingAttribution
    )

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
      })
      logger.info('Background resume execution completed', {
        resumeExecutionId,
        workflowId,
        success: result.success,
        status: result.status,
      })
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
        const result = await runResumeAndCellTerminal(payload, pausedExecution, writers)
        if (result.status === 'paused') return result
        await continueCascadeAfterResume(cellContext, billingAttribution)
        return result
      }
    )

    let result
    if (outcome.status === 'contended') {
      logger.info(
        `Resume cascade lock held — writing resumed group only (table=${cellContext.tableId} row=${cellContext.rowId} executionId=${parentExecutionId})`
      )
      result = await runResumeAndCellTerminal(payload, pausedExecution, writers)
    } else {
      result = outcome.result
    }

    logger.info('Background resume execution completed', {
      resumeExecutionId,
      workflowId,
      success: result.success,
      status: result.status,
    })

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
    logger.error('Background resume execution failed', {
      resumeExecutionId,
      workflowId,
      error: toError(error).message,
    })
    throw error
  }
}

type CellWriters = {
  cellOnBlockComplete: (blockId: string, output: unknown) => Promise<void>
  writeCellTerminal: (
    status: 'completed' | 'error' | 'paused',
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
  const { createWorkflowCellProgressWriter, writeWorkflowGroupState } = await import(
    '@/lib/table/cell-write'
  )

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
    writeProgress: ({ dataPatch, eventOutputs, blockErrors }) => {
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
      })
    },
    onWriteError: (err) => {
      logger.warn(
        `Resume per-block partial write failed (table=${cellContext.tableId} row=${cellContext.rowId} group=${cellContext.groupId}):`,
        err
      )
    },
  })

  const cellOnBlockComplete = progressWriter.onBlockComplete

  const writeCellTerminal = async (
    status: 'completed' | 'error' | 'paused',
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
    })
  }

  return { cellOnBlockComplete, writeCellTerminal }
}

async function runResumeAndCellTerminal(
  payload: ResumeExecutionPayload,
  pausedExecution: Awaited<ReturnType<typeof PauseResumeManager.getPausedExecutionById>>,
  writers: CellWriters
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
  })

  if (result.status === 'paused') {
    await writers.writeCellTerminal('paused', null)
  } else if (result.success) {
    await writers.writeCellTerminal('completed', null)
  } else {
    await writers.writeCellTerminal('error', result.error ?? 'Workflow execution failed')
  }

  return result
}

async function continueCascadeAfterResume(
  cellContext: {
    tableId: string
    rowId: string
    workspaceId: string
    groupId: string
  },
  billingAttribution: BillingAttributionSnapshot
): Promise<void> {
  const { getTableById } = await import('@/lib/table/service')
  const { getRowById } = await import('@/lib/table/rows/service')
  const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')
  const { runRowCascadeLoop } = await import('@/background/workflow-column-execution')

  const freshTable = await getTableById(cellContext.tableId)
  if (!freshTable) return
  const freshRow = await getRowById(cellContext.tableId, cellContext.rowId, cellContext.workspaceId)
  if (!freshRow) return
  const next = pickNextEligibleGroupForRow(freshTable, freshRow, cellContext.groupId)
  if (!next) return
  await runRowCascadeLoop({
    tableId: cellContext.tableId,
    tableName: freshTable.name,
    rowId: cellContext.rowId,
    workspaceId: cellContext.workspaceId,
    groupId: next.id,
    workflowId: next.workflowId,
    executionId: generateId(),
    billingAttribution,
  })
}

export const resumeExecutionTask = task({
  id: 'resume-execution',
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  queue: {
    concurrencyLimit: RESUME_EXECUTION_CONCURRENCY_LIMIT,
  },
  run: executeResumeJob,
})
