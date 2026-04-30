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
 * Background workflow-column execution. Runs in a trigger.dev worker; writes
 * the terminal cell state (`completed`/`error`). Cancellation is authoritative
 * via `cancelWorkflowColumnRuns` — this task can't be the source of truth for
 * `cancelled` because trigger.dev may kill it before its own write lands.
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
    const { writeWorkflowCell } = await import('@/lib/table/cell-write')

    const cellCtx = { tableId, rowId, columnName, workspaceId, executionId, requestId }
    const writeCell = (value: WorkflowCellValue) => writeWorkflowCell(cellCtx, value)

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

      // Spread row columns as top-level inputs so Start block fields resolve
      // directly by column name; reserved metadata keys win on collision.
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

      // Picked outputs only (keyed `[blockId][path]`) so cells fit within the
      // 100KB row cap when several workflow columns share a row.
      const { pluckByPath } = await import('@/lib/table/pluck')
      const columnDef = table.schema.columns.find((c) => c.name === columnName)
      const pickedPathsByBlock = new Map<string, string[]>()
      for (const out of columnDef?.workflowConfig?.outputs ?? []) {
        const list = pickedPathsByBlock.get(out.blockId) ?? []
        list.push(out.path)
        pickedPathsByBlock.set(out.blockId, list)
      }

      const blockOutputs: Record<string, Record<string, unknown>> = {}
      const blockErrors: Record<string, string> = {}
      const runningBlockIds = new Set<string>()
      let writeChain: Promise<void> = Promise.resolve()
      const schedulePartialWrite = () => {
        const blockOutputsSnapshot: Record<string, Record<string, unknown>> = {}
        for (const [k, v] of Object.entries(blockOutputs)) {
          blockOutputsSnapshot[k] = { ...v }
        }
        const blockErrorsSnapshot = { ...blockErrors }
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
              blockErrors: blockErrorsSnapshot,
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

        const blockErrorMessage =
          blockResult &&
          typeof blockResult === 'object' &&
          typeof (blockResult as { error?: unknown }).error === 'string'
            ? (blockResult as { error: string }).error
            : null

        if (blockErrorMessage) {
          // Per-block error: only the fanned-out cells sourced from this block
          // render as `error`. The workflow keeps executing — error ports etc.
          // are a normal Sim concept, so the column-level status stays driven
          // by the run as a whole.
          blockErrors[blockId] = blockErrorMessage
        } else {
          const slot: Record<string, unknown> = blockOutputs[blockId] ?? {}
          for (const path of paths) {
            slot[path] = pluckByPath(blockResult, path)
          }
          blockOutputs[blockId] = slot
        }
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

      // Drain queued partial writes before the terminal write so a late
      // `running` partial doesn't clobber it.
      await writeChain.catch(() => {})

      await writeCell({
        executionId,
        jobId: null,
        workflowId,
        status: result.success ? 'completed' : 'error',
        output: null,
        error: result.success ? null : (result.error ?? 'Workflow execution failed'),
        blockOutputs,
        blockErrors,
        runningBlockIds: [],
      })
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
  // Combined with `concurrencyKey: tableId`, caps each table's sub-queue to
  // 10 in-flight cell jobs while letting different tables run in parallel.
  queue: {
    name: 'workflow-column-execution',
    concurrencyLimit: 10,
  },
  run: (payload: WorkflowColumnExecutionPayload, { signal }) =>
    executeWorkflowColumnJob(payload, signal),
})
