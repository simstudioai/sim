import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import type { RowData, WorkflowCellValue } from '@/lib/table/types'

const logger = createLogger('TriggerWorkflowColumnExecution')

export type WorkflowColumnExecutionPayload = {
  tableId: string
  tableName: string
  rowId: string
  columnName: string
  workflowId: string
  workspaceId: string
  /** Sim-side correlation id used as `wfcol-${executionId}` in logs/requestId. */
  executionId: string
}

/**
 * Background workflow-column execution. Runs in a trigger.dev worker so the
 * cancel API can call `runs.cancel(jobId)` from any Next.js pod and have it
 * reach the worker holding the run.
 *
 * The Sim caller (`runWorkflowColumn` in `lib/table/workflow-columns.ts`) writes
 * `status: 'running'` and stores this run's `jobId` on the cell *before* enqueue.
 * This task is responsible for the terminal write (`completed` or `error`).
 * Cancellation is handled out-of-band: the cancel API authoritatively writes
 * `status: 'cancelled'` so the UI is deterministic regardless of whether the
 * task gets a chance to observe the abort.
 */
export async function executeWorkflowColumnJob(
  payload: WorkflowColumnExecutionPayload,
  signal?: AbortSignal
) {
  const { tableId, tableName, rowId, columnName, workflowId, workspaceId, executionId } = payload
  const requestId = `wfcol-${executionId}`

  return runWithRequestContext({ requestId }, async () => {
    const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')
    const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')
    const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')

    /**
     * Skip the terminal write if the cancel API has already authoritatively
     * written `cancelled` for this run. Two ways we detect that:
     * - The local AbortSignal we were handed was aborted.
     * - The current cell on disk is `cancelled` for this `executionId`
     *   (covers trigger.dev cancels where there is no in-process signal).
     * Without this guard, a workflow that finishes after the user clicks stop
     * overwrites `cancelled` with `completed`/`error`.
     */
    const writeCell = async (value: WorkflowCellValue) => {
      const table = await getTableById(tableId)
      if (!table) {
        logger.warn(`Table ${tableId} vanished before cell write`)
        return
      }
      const row = await getRowById(tableId, rowId, workspaceId)
      if (!row) {
        logger.warn(`Row ${rowId} vanished before cell write`)
        return
      }
      const currentCell = row.data[columnName] as WorkflowCellValue | null | undefined
      if (
        (signal?.aborted ||
          (currentCell?.status === 'cancelled' && currentCell.executionId === executionId)) &&
        value.status !== 'cancelled'
      ) {
        logger.info(
          `Skipping terminal cell write — run was cancelled (table=${tableId} row=${rowId} col=${columnName} executionId=${executionId})`
        )
        return
      }
      const mergedData: RowData = {
        ...row.data,
        [columnName]: value as unknown as RowData[string],
      }
      await updateRow({ tableId, rowId, data: mergedData, workspaceId }, table, requestId)
    }

    try {
      const [workflowRecord] = await db
        .select()
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!workflowRecord || !workflowRecord.isDeployed) {
        await writeCell({
          executionId,
          jobId: null,
          workflowId,
          status: 'error',
          output: null,
          error: !workflowRecord ? 'Workflow not found' : 'Workflow is not deployed',
        })
        return
      }

      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
      const startBlock = normalizedData
        ? Object.values(normalizedData.blocks).find((b) => b?.type === 'start_trigger')
        : undefined
      if (!startBlock) {
        await writeCell({
          executionId,
          jobId: null,
          workflowId,
          status: 'error',
          output: null,
          error: 'Workflow is missing a Start trigger',
        })
        return
      }

      const row = await getRowById(tableId, rowId, workspaceId)
      if (!row) {
        logger.warn(`Row ${rowId} vanished before execution`)
        return
      }
      const table = await getTableById(tableId)
      if (!table) {
        logger.warn(`Table ${tableId} vanished before execution`)
        return
      }

      const inputRow: Record<string, unknown> = {}
      for (const key of Object.keys(row.data)) {
        if (key === columnName) continue
        inputRow[key] = row.data[key]
      }

      const headers = table.schema.columns.filter((c) => c.name !== columnName).map((c) => c.name)

      // Spread the row's columns as top-level inputs so a Start block input
      // named `email` resolves directly from the row's `email` column. Reserved
      // metadata keys (row, rowId, headers, etc.) win on collision — a user
      // column named `row` is still reachable via the `row` JSON below.
      const input = {
        ...inputRow,
        row: inputRow,
        rawRow: inputRow,
        previousRow: null,
        changedColumns: [],
        rowId,
        headers,
        rowNumber: row.position,
        tableId,
        tableName,
        timestamp: new Date().toISOString(),
      }

      // Per-block live updates: as each block completes, accumulate its output
      // and push a partial cell write so the row's visual columns light up live.
      // Writes are serialized through a Promise chain to prevent lost-update
      // races when blocks complete in parallel (loops, parallels).
      const blockOutputs: Record<string, unknown> = {}
      let writeChain: Promise<void> = Promise.resolve()
      const writePartialBlockOutputs = (snapshot: Record<string, unknown>) => {
        writeChain = writeChain
          .then(async () => {
            if (signal?.aborted) return
            const t = await getTableById(tableId)
            if (!t) return
            const r = await getRowById(tableId, rowId, workspaceId)
            if (!r) return
            const cell = r.data[columnName] as WorkflowCellValue | null | undefined
            // Bail if this run was cancelled, replaced, or already terminal.
            if (!cell || cell.executionId !== executionId || cell.status !== 'running') return
            const updatedCell: WorkflowCellValue = { ...cell, blockOutputs: snapshot }
            const mergedData: RowData = {
              ...r.data,
              [columnName]: updatedCell as unknown as RowData[string],
            }
            await updateRow({ tableId, rowId, data: mergedData, workspaceId }, t, requestId)
          })
          .catch((err) => {
            logger.warn(
              `Per-block cell write failed (table=${tableId} row=${rowId} col=${columnName}):`,
              err
            )
          })
      }

      const onBlockComplete = async (blockId: string, output: unknown): Promise<void> => {
        // executor hands us `{ input?, output: NormalizedBlockOutput, executionTime, ... }`.
        // Persist just the inner `output` so saved column paths pluck against the same
        // shape `flattenWorkflowOutputs` introspected from the block definitions.
        const blockResult =
          output && typeof output === 'object' && 'output' in (output as object)
            ? (output as { output: unknown }).output
            : output
        blockOutputs[blockId] = blockResult
        writePartialBlockOutputs({ ...blockOutputs })
      }

      const result = await executeWorkflow(
        {
          id: workflowRecord.id,
          userId: workflowRecord.userId,
          workspaceId: workflowRecord.workspaceId,
          variables: (workflowRecord.variables as Record<string, unknown> | null) ?? {},
        },
        requestId,
        input,
        workflowRecord.userId,
        {
          enabled: true,
          executionMode: 'sync',
          workflowTriggerType: 'table',
          triggerBlockId: startBlock.id,
          abortSignal: signal,
          onBlockComplete,
        },
        executionId
      )

      // Drain pending partial writes so the terminal write isn't clobbered by a
      // late `running` partial that followed it on the chain.
      await writeChain.catch(() => {})

      if (result.success) {
        const rawOutput = (result.output as unknown) ?? null
        await writeCell({
          executionId,
          jobId: null,
          workflowId,
          status: 'completed',
          output: rawOutput,
          error: null,
          blockOutputs,
        })
      } else {
        await writeCell({
          executionId,
          jobId: null,
          workflowId,
          status: 'error',
          output: null,
          error: result.error ?? 'Workflow execution failed',
          blockOutputs,
        })
      }
    } catch (err) {
      const message = toError(err).message
      logger.error(
        `Workflow column execution failed (table=${tableId} row=${rowId} col=${columnName})`,
        { error: message, executionId }
      )
      try {
        await writeCell({
          executionId,
          jobId: null,
          workflowId,
          status: 'error',
          output: null,
          error: message,
        })
      } catch (writeErr) {
        logger.error('Also failed to write error state', { error: toError(writeErr).message })
      }
    }
  })
}

export const workflowColumnExecutionTask = task({
  id: 'workflow-column-execution',
  machine: 'medium-1x',
  retry: { maxAttempts: 1 },
  run: (payload: WorkflowColumnExecutionPayload, { signal }) =>
    executeWorkflowColumnJob(payload, signal),
})
