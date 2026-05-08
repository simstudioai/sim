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

import { createLogger } from '@sim/logger'
import type { RowData, RowExecutionMetadata, RowExecutions, WorkflowGroup } from '@/lib/table/types'

const logger = createLogger('WorkflowCellWrite')

export interface WriteWorkflowGroupContext {
  tableId: string
  rowId: string
  workspaceId: string
  groupId: string
  executionId: string
  /** Used as the `requestId` passed to `updateRow` for log correlation. */
  requestId?: string
}

export interface WriteWorkflowGroupStatePayload {
  /** Plain primitives to merge into `row.data`. Empty patch is fine. */
  dataPatch?: RowData
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
  const { tableId, rowId, workspaceId, groupId, executionId } = ctx
  const requestId = ctx.requestId ?? `wfgrp-${executionId}`
  const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')

  const table = await getTableById(tableId)
  if (!table) {
    logger.warn(`Table ${tableId} vanished before group state write`)
    return 'wrote'
  }
  const row = await getRowById(tableId, rowId, workspaceId)
  if (!row) {
    logger.warn(`Row ${rowId} vanished before group state write`)
    return 'wrote'
  }
  const current = row.executions?.[groupId] as RowExecutionMetadata | undefined
  // Stale-worker guard: only blocks writes FROM an old worker (status =
  // running / completed / error / pending). A `queued` stamp from the
  // scheduler can claim the cell for a brand-new run — that's the new
  // authority. Same for `cancelled` (always authoritative, written by stop).
  const isCancelStamp = payload.executionState.status === 'cancelled'
  const isQueuedStamp = payload.executionState.status === 'queued'
  const isNewQueuedStamp = isQueuedStamp && current?.executionId !== executionId
  const bypassStaleWorker = isNewQueuedStamp || isCancelStamp
  if (!bypassStaleWorker && current && current.executionId && current.executionId !== executionId) {
    logger.info(
      `Skipping group write — stale worker (table=${tableId} row=${rowId} group=${groupId} mine=${executionId} active=${current.executionId})`
    )
    return 'skipped'
  }
  // A late `queued` stamp for the SAME run that's already moved past queued
  // (worker called markWorkflowGroupPickedUp before our parallel stamp landed)
  // must NOT overwrite the further-along state. Without this, a cell can show
  // "queued" forever while the worker is actually running.
  if (isQueuedStamp && current?.executionId === executionId && current.status !== 'pending') {
    logger.info(
      `Skipping queued stamp — same run already at status=${current.status} (table=${tableId} row=${rowId} group=${groupId} executionId=${executionId})`
    )
    return 'skipped'
  }
  if (
    current?.status === 'cancelled' &&
    current.executionId === executionId &&
    payload.executionState.status !== 'cancelled'
  ) {
    logger.info(
      `Skipping group write — cancelled (table=${tableId} row=${rowId} group=${groupId} executionId=${executionId})`
    )
    return 'skipped'
  }
  // Skip writing `cancelled` state with the guard — that's an authoritative
  // write from `cancelWorkflowGroupRuns` and must always land. New `queued`
  // stamps from the scheduler also bypass — they ARE the new authority. Cell-
  // task writes (running/completed/error) get the SQL guard so an in-flight
  // partial can't clobber a stop click or a newer run that already committed.
  const cancellationGuard = bypassStaleWorker ? undefined : { groupId, executionId }
  const result = await updateRow(
    {
      tableId,
      rowId,
      data: payload.dataPatch ?? {},
      workspaceId,
      executionsPatch: { [groupId]: payload.executionState },
      cancellationGuard,
    },
    table,
    requestId
  )
  if (result === null) {
    logger.info(
      `Skipping group write — SQL guard saw cancelled (table=${tableId} row=${rowId} group=${groupId} executionId=${executionId})`
    )
    return 'skipped'
  }
  return 'wrote'
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
 *  a value or an error should flip to "Cancelled". */
export function buildCancelledExecution(
  prev: Pick<RowExecutionMetadata, 'executionId' | 'workflowId' | 'blockErrors'>
): RowExecutionMetadata {
  return {
    status: 'cancelled',
    executionId: prev.executionId ?? null,
    jobId: null,
    workflowId: prev.workflowId,
    error: 'Cancelled',
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
