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
      // Only short-circuit when the cancel API has authoritatively written
      // `cancelled` for THIS run. Don't skip on `signal.aborted` alone — that
      // conflates user-cancel with infra timeout / worker death and would
      // leave cells stuck in `running` forever after a SIGTERM kill.
      if (
        currentCell?.status === 'cancelled' &&
        currentCell.executionId === executionId &&
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

      // Per-block live updates. Storage is keyed `{[blockId]: {[path]: pluckedValue}}`
      // — only the user's picked outputs are persisted, so cells stay small
      // enough for the 100KB row cap even when multiple workflow columns share
      // a row. Plus per-block `runningBlockIds` so fanned-out visual columns
      // can show waiting / in-progress / done independently.
      const { pluckByPath } = await import('@/lib/table/pluck')
      const columnDef = table.schema.columns.find((c) => c.name === columnName)
      const pickedPathsByBlock = new Map<string, string[]>()
      for (const out of columnDef?.workflowConfig?.outputs ?? []) {
        const list = pickedPathsByBlock.get(out.blockId) ?? []
        list.push(out.path)
        pickedPathsByBlock.set(out.blockId, list)
      }

      const blockOutputs: Record<string, Record<string, unknown>> = {}
      const runningBlockIds = new Set<string>()
      let writeChain: Promise<void> = Promise.resolve()
      const schedulePartialWrite = () => {
        const blockOutputsSnapshot: Record<string, Record<string, unknown>> = {}
        for (const [k, v] of Object.entries(blockOutputs)) {
          blockOutputsSnapshot[k] = { ...v }
        }
        const runningSnapshot = Array.from(runningBlockIds)
        writeChain = writeChain
          .then(async () => {
            if (signal?.aborted) return
            const t = await getTableById(tableId)
            if (!t) return
            const r = await getRowById(tableId, rowId, workspaceId)
            if (!r) return
            const cell = r.data[columnName] as WorkflowCellValue | null | undefined
            if (!cell || cell.executionId !== executionId || cell.status !== 'running') return
            const updatedCell: WorkflowCellValue = {
              ...cell,
              blockOutputs: blockOutputsSnapshot,
              runningBlockIds: runningSnapshot,
            }
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

      const onBlockStart = async (blockId: string): Promise<void> => {
        if (!pickedPathsByBlock.has(blockId)) return
        runningBlockIds.add(blockId)
        schedulePartialWrite()
      }

      const onBlockComplete = async (blockId: string, output: unknown): Promise<void> => {
        const paths = pickedPathsByBlock.get(blockId)
        if (!paths) return
        // executor hands us `{ input?, output: NormalizedBlockOutput, executionTime, ... }`
        const blockResult =
          output && typeof output === 'object' && 'output' in (output as object)
            ? (output as { output: unknown }).output
            : output
        const slot: Record<string, unknown> = blockOutputs[blockId] ?? {}
        for (const path of paths) {
          slot[path] = pluckByPath(blockResult, path)
        }
        blockOutputs[blockId] = slot
        runningBlockIds.delete(blockId)
        schedulePartialWrite()
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
          onBlockStart,
          onBlockComplete,
        },
        executionId
      )

      // Drain pending partial writes so the terminal write isn't clobbered by a
      // late `running` partial that followed it on the chain.
      await writeChain.catch(() => {})

      if (result.success) {
        // `cell.output` is intentionally null — the renderer reads from
        // `blockOutputs[blockId][path]`. Storing the full output too would
        // double the row size with no benefit.
        await writeCell({
          executionId,
          jobId: null,
          workflowId,
          status: 'completed',
          output: null,
          error: null,
          blockOutputs,
          runningBlockIds: [],
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
          runningBlockIds: [],
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
  // With `concurrencyKey: tableId` set at enqueue time, this caps each table's
  // sub-queue to 10 cell jobs in flight at once. Different tables run in
  // parallel (different sub-queues). Cascade across columns happens via
  // `updateRow` → `scheduleWorkflowColumnRuns` after each cell completes.
  // The 10 is an invariant for now; future work could expose this per-table.
  queue: {
    name: 'workflow-column-execution',
    concurrencyLimit: 10,
  },
  run: (payload: WorkflowColumnExecutionPayload, { signal }) =>
    executeWorkflowColumnJob(payload, signal),
})
