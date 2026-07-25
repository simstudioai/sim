/**
 * Shared cell-write primitives for workflow-group execution paths.
 *
 * Both the scheduler (`runWorkflowGroupCell`) and the cell task body
 * (`executeWorkflowGroupCellJob`) need to write `data` patches + `executions`
 * patches together while honoring the `cancelled` state written by
 * `cancelWorkflowGroupRuns` — without the guard, a stop click that lands
 * mid-enqueue or mid-run would get clobbered by the in-flight code path's
 * next write.
 */

import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { appendTableEvent } from '@/lib/table/events'
import { pluckByPath } from '@/lib/table/pluck'
import { writeExecutionsPatch } from '@/lib/table/rows/executions'
import type {
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  TableDefinition,
  WorkflowGroup,
} from '@/lib/table/types'

const logger = createLogger('WorkflowCellWrite')

export interface WriteWorkflowGroupContext {
  tableId: string
  rowId: string
  workspaceId: string
  groupId: string
  executionId: string
  /** Preloaded, column-bounded table definition used to validate data patches. */
  table: TableDefinition
  /** Used as the `requestId` passed to `updateRow` for log correlation. */
  requestId?: string
}

export interface WriteWorkflowGroupStatePayload {
  /** Plain primitives to merge into `row.data`. Empty patch is fine. */
  dataPatch?: RowData
  /** Cumulative outputs emitted to SSE consumers without rewriting them to the database. */
  eventOutputs?: RowData
  /** New execution state for `executions[groupId]`. */
  executionState: RowExecutionMetadata
}

/**
 * Writes the row unless `cancelWorkflowGroupRuns` has already authoritatively
 * written `cancelled` for this run. Returns `'skipped'` so the caller can
 * short-circuit any follow-up writes / job dispatch.
 */
export async function writeWorkflowGroupState(
  ctx: WriteWorkflowGroupContext,
  payload: WriteWorkflowGroupStatePayload
): Promise<'wrote' | 'skipped'> {
  const { tableId, rowId, workspaceId, groupId, executionId, table } = ctx
  const requestId = ctx.requestId ?? `wfgrp-${executionId}`
  const isCancelStamp = payload.executionState.status === 'cancelled'
  const isQueuedStamp = payload.executionState.status === 'queued'
  const cancellationGuard = isCancelStamp
    ? undefined
    : {
        groupId,
        executionId,
        ...(isQueuedStamp ? { allowNewExecution: true } : {}),
      }
  const executionsPatch = { [groupId]: payload.executionState }
  const dataPatch = payload.dataPatch
  const hasDataPatch = Boolean(dataPatch && Object.keys(dataPatch).length > 0)

  let result: unknown
  if (hasDataPatch) {
    const { updateRow } = await import('@/lib/table/rows/service')
    result = await updateRow(
      {
        tableId,
        rowId,
        data: dataPatch ?? {},
        workspaceId,
        executionsPatch,
        cancellationGuard,
      },
      table,
      requestId,
      { dataWriteMode: 'patch' }
    )
  } else {
    result = await db.transaction((trx) =>
      writeExecutionsPatch(trx, tableId, rowId, executionsPatch, cancellationGuard)
    )
  }
  if (result === null || result === 'guard-rejected') {
    logger.info(
      `Skipping group write — SQL guard rejected stale or cancelled attempt (table=${tableId} row=${rowId} group=${groupId} executionId=${executionId})`
    )
    return 'skipped'
  }

  const eventOutputs = payload.eventOutputs ?? dataPatch
  const hasOutputs = eventOutputs && Object.keys(eventOutputs).length > 0
  const runningBlockIds = payload.executionState.runningBlockIds
  const blockErrors = payload.executionState.blockErrors
  void appendTableEvent({
    kind: 'cell',
    tableId,
    rowId,
    groupId,
    status: payload.executionState.status,
    executionId: payload.executionState.executionId ?? null,
    jobId: payload.executionState.jobId ?? null,
    error: payload.executionState.error ?? null,
    ...(hasOutputs ? { outputs: eventOutputs } : {}),
    ...(runningBlockIds && runningBlockIds.length > 0 ? { runningBlockIds } : {}),
    ...(blockErrors && Object.keys(blockErrors).length > 0 ? { blockErrors } : {}),
  })

  return 'wrote'
}

export interface WorkflowCellProgressWrite {
  dataPatch: RowData | undefined
  eventOutputs: RowData
  runningBlockIds: string[]
  blockErrors: Record<string, string>
}

interface CreateWorkflowCellProgressWriterOptions {
  group: WorkflowGroup
  signal?: AbortSignal
  writeProgress: (write: WorkflowCellProgressWrite) => Promise<'wrote' | 'skipped'>
  onWriteError: (error: unknown) => void
}

export interface WorkflowCellProgressWriter {
  onBlockStart: (blockId: string) => Promise<void>
  onBlockComplete: (blockId: string, output: unknown) => Promise<void>
  waitForPendingWrites: () => Promise<void>
  finish: () => Promise<void>
  getEventOutputs: () => RowData
  getPendingDataPatch: () => RowData
  getBlockErrors: () => Record<string, string>
}

/**
 * Serializes per-output-block progress while separating incremental database
 * patches from cumulative SSE payloads. Failed or terminal-suppressed patches
 * remain pending so the terminal write can recover them once.
 */
export function createWorkflowCellProgressWriter(
  options: CreateWorkflowCellProgressWriterOptions
): WorkflowCellProgressWriter {
  const outputsByBlockId = buildOutputsByBlockId(options.group)
  const eventOutputs: RowData = {}
  const pendingDataPatch: RowData = {}
  const retryDataPatch: RowData = {}
  const runningBlockIds = new Set<string>()
  const blockErrors: Record<string, string> = {}
  let writeChain: Promise<void> = Promise.resolve()
  let terminalWritten = false

  const scheduleWrite = (dataPatch: RowData | undefined): void => {
    const eventSnapshot = {
      eventOutputs: { ...eventOutputs },
      runningBlockIds: Array.from(runningBlockIds),
      blockErrors: { ...blockErrors },
    }
    writeChain = writeChain.then(async () => {
      if (options.signal?.aborted || terminalWritten) return
      const pendingRetry = { ...retryDataPatch, ...dataPatch }
      const write: WorkflowCellProgressWrite = {
        ...eventSnapshot,
        dataPatch: Object.keys(pendingRetry).length > 0 ? pendingRetry : undefined,
      }
      try {
        const result = await options.writeProgress(write)
        if (result !== 'wrote' || !write.dataPatch) return
        for (const [columnId, value] of Object.entries(write.dataPatch)) {
          if (Object.is(pendingDataPatch[columnId], value)) {
            delete pendingDataPatch[columnId]
          }
          if (Object.is(retryDataPatch[columnId], value)) {
            delete retryDataPatch[columnId]
          }
        }
      } catch (error) {
        for (const [columnId, value] of Object.entries(write.dataPatch ?? {})) {
          if (Object.is(pendingDataPatch[columnId], value)) {
            retryDataPatch[columnId] = value
          }
        }
        options.onWriteError(error)
      }
    })
  }

  const onBlockStart = async (blockId: string): Promise<void> => {
    if (!outputsByBlockId.has(blockId)) return
    runningBlockIds.add(blockId)
    scheduleWrite(undefined)
  }

  const onBlockComplete = async (blockId: string, output: unknown): Promise<void> => {
    const outputs = outputsByBlockId.get(blockId)
    if (!outputs) return

    const blockResult =
      output && typeof output === 'object' && 'output' in output
        ? (output as { output: unknown }).output
        : output
    const blockErrorMessage =
      blockResult &&
      typeof blockResult === 'object' &&
      typeof (blockResult as { error?: unknown }).error === 'string'
        ? (blockResult as { error: string }).error
        : null
    const changedData: RowData = {}

    if (blockErrorMessage) {
      blockErrors[blockId] = blockErrorMessage
    } else {
      for (const outputMapping of outputs) {
        const value = pluckByPath(blockResult, outputMapping.path)
        if (value === undefined) continue
        changedData[outputMapping.columnName] = value as RowData[string]
        eventOutputs[outputMapping.columnName] = value as RowData[string]
        pendingDataPatch[outputMapping.columnName] = value as RowData[string]
      }
    }
    runningBlockIds.delete(blockId)
    scheduleWrite(Object.keys(changedData).length > 0 ? changedData : undefined)
  }

  const waitForPendingWrites = async (): Promise<void> => {
    await writeChain
  }

  const finish = async (): Promise<void> => {
    terminalWritten = true
    await writeChain
  }

  return {
    onBlockStart,
    onBlockComplete,
    waitForPendingWrites,
    finish,
    getEventOutputs: () => ({ ...eventOutputs }),
    getPendingDataPatch: () => ({ ...pendingDataPatch }),
    getBlockErrors: () => ({ ...blockErrors }),
  }
}

/**
 * Flips `queued` → `running` to signal the cell task body has actually been
 * picked up by a worker. The renderer uses the `queued` vs `running` distinction
 * to label cells "Queued" vs "Waiting" (worker started, this block hasn't run
 * yet) — without this marker we couldn't tell if a row was sitting in the
 * trigger.dev queue or actively executing.
 */
export async function markWorkflowGroupPickedUp(
  ctx: WriteWorkflowGroupContext,
  prev: Pick<RowExecutionMetadata, 'workflowId' | 'jobId'>
): Promise<'wrote' | 'skipped'> {
  return writeWorkflowGroupState(ctx, {
    executionState: {
      status: 'running',
      executionId: ctx.executionId,
      jobId: prev.jobId,
      workflowId: prev.workflowId,
      error: null,
    },
  })
}

/** Builds the canonical `cancelled` execution state used by every cancel path.
 *  Preserves `blockErrors` from the prior state so errored cells keep
 *  rendering Error after a stop click — only cells that hadn't yet produced
 *  a value or an error should flip to "Cancelled". `cancelledAt` is the
 *  tombstone the dispatcher reads to skip re-runs of cells the user killed
 *  mid-cascade. */
export function buildCancelledExecution(
  prev: Pick<RowExecutionMetadata, 'executionId' | 'workflowId' | 'blockErrors'>
): RowExecutionMetadata {
  return {
    status: 'cancelled',
    executionId: prev.executionId ?? null,
    jobId: null,
    workflowId: prev.workflowId,
    error: 'Cancelled',
    cancelledAt: new Date().toISOString(),
    ...(prev.blockErrors ? { blockErrors: prev.blockErrors } : {}),
  }
}

/**
 * Maps a group's `outputs[]` to a `blockId → Array<{path, columnName}>` map.
 * The cell task uses this to fan a single block-complete event into N column
 * writes.
 */
export function buildOutputsByBlockId(
  group: WorkflowGroup
): Map<string, Array<{ path: string; columnName: string }>> {
  const map = new Map<string, Array<{ path: string; columnName: string }>>()
  for (const out of group.outputs) {
    const list = map.get(out.blockId) ?? []
    list.push({ path: out.path, columnName: out.columnName })
    map.set(out.blockId, list)
  }
  return map
}

/** Type-narrowing helper used by readers that can't assume `executions` is set. */
export function readExecutions(
  row: { executions?: RowExecutions } | null | undefined
): RowExecutions {
  return row?.executions ?? {}
}
