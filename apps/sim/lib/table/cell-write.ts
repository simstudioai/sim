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
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getValueAtPath } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { appendTableEvent } from '@/lib/table/events'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import { writeExecutionsPatch } from '@/lib/table/rows/executions'
import {
  createTableRowSecretProvenanceFromEncryptedExecution,
  createUnknownTableRowSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type {
  RowData,
  RowExecutionMetadata,
  TableDefinition,
  TableRowSecretProvenanceWrite,
  WorkflowGroup,
} from '@/lib/table/types'
import { coerceRowValues } from '@/lib/table/validation'
import type { BlockCompletionCallbackData } from '@/executor/execution/types'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

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
  /** Encrypted provenance narrowed to the exact values in `dataPatch`. */
  secretProvenance?: TableRowSecretProvenanceWrite
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
    try {
      result = await updateRow(
        {
          tableId,
          rowId,
          data: dataPatch ?? {},
          workspaceId,
          executionsPatch,
          cancellationGuard,
          secretProvenance: payload.secretProvenance,
          /**
           * A cell result carries no acting person down to this layer — the
           * write has no `actorUserId` either, so any cascade it fires is
           * already actorless on both the meter and the gate.
           */
          capabilityGovernedUserId: null,
        },
        table,
        requestId,
        // `computedWrite` is what lets a workflow column keep populating on an
        // update-locked table; the lock still covers user-authored columns.
        { computedWrite: true }
      )
    } catch (error) {
      if (!(error instanceof TableRowNotFoundError)) throw error
      result = null
    }
  } else {
    result = await db.transaction(async (trx) => {
      const [row] = await trx
        .select({ id: userTableRows.id })
        .from(userTableRows)
        .where(
          and(
            eq(userTableRows.id, rowId),
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, workspaceId)
          )
        )
        .limit(1)
        .for('key share')
      if (!row) return null
      return writeExecutionsPatch(trx, tableId, rowId, executionsPatch, cancellationGuard)
    })
  }
  if (result === null || result === 'guard-rejected') {
    logger.info(
      `Skipping group write — row missing or SQL guard rejected stale/cancelled attempt (table=${tableId} row=${rowId} group=${groupId} executionId=${executionId})`
    )
    return 'skipped'
  }

  // The SSE snapshot must carry what was persisted, not the raw block output.
  // `updateRow` coerces its own merged copy, so the patch object here still
  // holds the workflow's value — for a `select` column that's the option *name*
  // ("Open"), which the grid resolves as an option id, finds nothing, and
  // renders as an empty cell until the next refetch. Coerce a copy: the patch
  // object itself is identity-compared for the progress writer's retry
  // bookkeeping, so it must not be mutated. The `null` policy mirrors what
  // `updateRow` persists for a computed write, so the snapshot the client sees
  // and the row on disk agree about a block output its column cannot hold.
  const rawEventOutputs = payload.eventOutputs ?? dataPatch
  const hasOutputs = rawEventOutputs && Object.keys(rawEventOutputs).length > 0
  const eventOutputs = hasOutputs ? { ...rawEventOutputs } : rawEventOutputs
  if (hasOutputs && eventOutputs) coerceRowValues(eventOutputs, table.schema, 'null')
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
  secretProvenance?: TableRowSecretProvenanceWrite
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
  onBlockComplete: (
    blockId: string,
    data: Pick<BlockCompletionCallbackData, 'output' | 'resolvedSecretTraceProvenance'>
  ) => Promise<void>
  waitForPendingWrites: () => Promise<void>
  finish: () => Promise<void>
  getEventOutputs: () => RowData
  getPendingDataPatch: () => RowData
  getPendingSecretProvenance: () => TableRowSecretProvenanceWrite
  getBlockErrors: () => Record<string, string>
}

type ColumnSecretProvenance = ResolvedSecretTraceProvenanceV1 | null

function selectPatchSecretProvenance(
  dataPatch: RowData,
  provenanceByColumn: Record<string, ColumnSecretProvenance>
): TableRowSecretProvenanceWrite {
  const columns: Record<string, ResolvedSecretTraceProvenanceV1> = {}
  for (const columnId of Object.keys(dataPatch)) {
    const provenance = provenanceByColumn[columnId]
    if (!provenance?.complete) return createUnknownTableRowSecretProvenance()
    columns[columnId] = provenance
  }
  return { complete: true, columns }
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
  const pendingSecretProvenance: Record<string, ColumnSecretProvenance> = {}
  const retrySecretProvenance: Record<string, ColumnSecretProvenance> = {}
  const runningBlockIds = new Set<string>()
  const blockErrors: Record<string, string> = {}
  let completionChain: Promise<void> = Promise.resolve()
  let writeChain: Promise<void> = Promise.resolve()
  let terminalWritten = false

  const scheduleWrite = (dataPatch: RowData | undefined): void => {
    const provenancePatch = dataPatch
      ? Object.fromEntries(
          Object.keys(dataPatch).map((columnId) => [
            columnId,
            pendingSecretProvenance[columnId] ?? null,
          ])
        )
      : {}
    const eventSnapshot = {
      eventOutputs: { ...eventOutputs },
      runningBlockIds: Array.from(runningBlockIds),
      blockErrors: { ...blockErrors },
    }
    writeChain = writeChain.then(async () => {
      if (options.signal?.aborted || terminalWritten) return
      const pendingRetry = { ...retryDataPatch, ...dataPatch }
      const pendingRetryProvenance = { ...retrySecretProvenance, ...provenancePatch }
      const write: WorkflowCellProgressWrite = {
        ...eventSnapshot,
        dataPatch: Object.keys(pendingRetry).length > 0 ? pendingRetry : undefined,
        ...(Object.keys(pendingRetry).length > 0
          ? { secretProvenance: selectPatchSecretProvenance(pendingRetry, pendingRetryProvenance) }
          : {}),
      }
      try {
        const result = await options.writeProgress(write)
        if (result !== 'wrote' || !write.dataPatch) return
        for (const [columnId, value] of Object.entries(write.dataPatch)) {
          if (Object.is(pendingDataPatch[columnId], value)) {
            delete pendingDataPatch[columnId]
            delete pendingSecretProvenance[columnId]
          }
          if (Object.is(retryDataPatch[columnId], value)) {
            delete retryDataPatch[columnId]
            delete retrySecretProvenance[columnId]
          }
        }
      } catch (error) {
        for (const [columnId, value] of Object.entries(write.dataPatch ?? {})) {
          if (Object.is(pendingDataPatch[columnId], value)) {
            retryDataPatch[columnId] = value
            retrySecretProvenance[columnId] = pendingRetryProvenance[columnId] ?? null
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

  const onBlockComplete: WorkflowCellProgressWriter['onBlockComplete'] = async (blockId, data) => {
    const work = completionChain.then(async () => {
      const outputs = outputsByBlockId.get(blockId)
      if (!outputs) return

      const blockResult = data.output
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
          const value = getValueAtPath(blockResult, outputMapping.path)
          if (value === undefined) continue
          changedData[outputMapping.columnName] = value as RowData[string]
          eventOutputs[outputMapping.columnName] = value as RowData[string]
          pendingDataPatch[outputMapping.columnName] = value as RowData[string]
        }
        if (Object.keys(changedData).length > 0) {
          const provenance = await createTableRowSecretProvenanceFromEncryptedExecution(
            changedData,
            data.resolvedSecretTraceProvenance
          )
          for (const columnId of Object.keys(changedData)) {
            pendingSecretProvenance[columnId] = provenance.complete
              ? (provenance.columns[columnId] ?? null)
              : null
          }
        }
      }
      runningBlockIds.delete(blockId)
      scheduleWrite(Object.keys(changedData).length > 0 ? changedData : undefined)
    })
    completionChain = work.catch(options.onWriteError)
    await completionChain
  }

  const waitForPendingWrites = async (): Promise<void> => {
    await completionChain
    await writeChain
  }

  const finish = async (): Promise<void> => {
    await completionChain
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
    getPendingSecretProvenance: () =>
      selectPatchSecretProvenance(pendingDataPatch, pendingSecretProvenance),
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
