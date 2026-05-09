import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { task } from '@trigger.dev/sdk'
import type { RowData, RowExecutionMetadata } from '@/lib/table/types'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

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

    // If this paused execution belongs to a table cell, rehydrate the cell
    // context so post-resume block outputs land on the same row + group as
    // the original cell task. Without this, blocks that run after the human
    // approves write nothing back to the table — the row silently truncates
    // at the pause boundary. The original `parentExecutionId` is preserved
    // on the cell's `executions[gid]` so it stays one logical execution
    // across the pause/resume boundary.
    const { findCellContextByExecutionId } = await import('@/lib/table/workflow-columns')
    const cellContext = await findCellContextByExecutionId(parentExecutionId)

    let cellOnBlockComplete: ((blockId: string, output: unknown) => Promise<void>) | undefined
    let writeCellTerminal:
      | ((status: 'completed' | 'error' | 'paused', error: string | null) => Promise<void>)
      | undefined

    if (cellContext) {
      const { getTableById } = await import('@/lib/table/service')
      const { writeWorkflowGroupState, buildOutputsByBlockId } = await import(
        '@/lib/table/cell-write'
      )
      const { pluckByPath } = await import('@/lib/table/pluck')

      const table = await getTableById(cellContext.tableId)
      const group = table?.schema.workflowGroups?.find((g) => g.id === cellContext.groupId)
      if (group) {
        const outputsByBlockId = buildOutputsByBlockId(group)
        const accumulatedData: RowData = {}
        const blockErrors: Record<string, string> = {}
        const writeCtx = {
          tableId: cellContext.tableId,
          rowId: cellContext.rowId,
          workspaceId: cellContext.workspaceId,
          groupId: cellContext.groupId,
          executionId: parentExecutionId,
          requestId: `wfgrp-resume-${parentExecutionId}`,
        }
        let writeChain: Promise<void> = Promise.resolve()
        let terminalWritten = false

        cellOnBlockComplete = async (blockId, output) => {
          const outputs = outputsByBlockId.get(blockId)
          if (!outputs) return
          const blockResult =
            output && typeof output === 'object' && 'output' in (output as object)
              ? (output as { output: unknown }).output
              : output
          const errorMessage =
            blockResult &&
            typeof blockResult === 'object' &&
            typeof (blockResult as { error?: unknown }).error === 'string'
              ? (blockResult as { error: string }).error
              : null
          if (errorMessage) {
            blockErrors[blockId] = errorMessage
          } else {
            for (const out of outputs) {
              const plucked = pluckByPath(blockResult, out.path)
              if (plucked === undefined) continue
              accumulatedData[out.columnName] = plucked as RowData[string]
            }
          }
          const dataSnapshot: RowData = { ...accumulatedData }
          const blockErrorsSnapshot = { ...blockErrors }
          writeChain = writeChain
            .then(async () => {
              if (terminalWritten) return
              const partial: RowExecutionMetadata = {
                status: 'running',
                executionId: parentExecutionId,
                jobId: null,
                workflowId: cellContext.workflowId,
                error: null,
                blockErrors: blockErrorsSnapshot,
              }
              await writeWorkflowGroupState(writeCtx, {
                executionState: partial,
                dataPatch: dataSnapshot,
              })
            })
            .catch((err) => {
              logger.warn(
                `Resume per-block partial write failed (table=${cellContext.tableId} row=${cellContext.rowId} group=${cellContext.groupId}):`,
                err
              )
            })
        }

        writeCellTerminal = async (status, error) => {
          terminalWritten = true
          await writeChain.catch(() => {})
          // Paused → keep `pending` + sentinel jobId so eligibility predicates
          // continue treating the row as in-flight while we wait on another
          // pause. Mirrors the initial cell-task pause branch.
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
            dataPatch: accumulatedData,
          })
        }
      } else {
        logger.warn(
          'Cell context found but table or group missing — falling back to plain resume',
          {
            parentExecutionId,
            tableId: cellContext.tableId,
            groupId: cellContext.groupId,
          }
        )
      }
    }

    const result = await PauseResumeManager.startResumeExecution({
      resumeEntryId: payload.resumeEntryId,
      resumeExecutionId: payload.resumeExecutionId,
      pausedExecution,
      contextId: payload.contextId,
      resumeInput: payload.resumeInput,
      userId: payload.userId,
      ...(cellOnBlockComplete ? { onBlockComplete: cellOnBlockComplete } : {}),
    })

    if (writeCellTerminal) {
      if (result.status === 'paused') {
        await writeCellTerminal('paused', null)
      } else if (result.success) {
        await writeCellTerminal('completed', null)
      } else {
        await writeCellTerminal('error', result.error ?? 'Workflow execution failed')
      }
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

export const resumeExecutionTask = task({
  id: 'resume-execution',
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  run: executeResumeJob,
})
