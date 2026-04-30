import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import type { RowData, RowExecutionMetadata } from '@/lib/table/types'

const logger = createLogger('TriggerWorkflowGroupCell')

export type WorkflowGroupCellPayload = {
  tableId: string
  tableName: string
  rowId: string
  groupId: string
  workflowId: string
  workspaceId: string
  /** Sim-side correlation id used as `wfgrp-${executionId}` in logs/requestId. */
  executionId: string
}

/**
 * Background workflow-group cell execution. Runs in a trigger.dev worker;
 * writes plain primitives into `row.data[output.columnName]` as picked
 * blocks complete, and execution state into `row.executions[groupId]`.
 * Cancellation is authoritative via `cancelWorkflowGroupRuns`.
 */
export async function executeWorkflowGroupCellJob(
  payload: WorkflowGroupCellPayload,
  signal?: AbortSignal
) {
  const { tableId, tableName, rowId, groupId, workflowId, workspaceId, executionId } = payload
  const requestId = `wfgrp-${executionId}`

  return runWithRequestContext({ requestId }, async () => {
    const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')
    const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')
    const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
    const { writeWorkflowGroupState, buildOutputsByBlockId } = await import(
      '@/lib/table/cell-write'
    )

    const cellCtx = { tableId, rowId, workspaceId, groupId, executionId, requestId }
    const writeState = (
      executionState: RowExecutionMetadata,
      dataPatch?: RowData
    ) => writeWorkflowGroupState(cellCtx, { executionState, dataPatch })

    try {
      const table = await getTableById(tableId)
      if (!table) {
        logger.warn(`Table ${tableId} vanished before execution`)
        return
      }
      const group = (table.schema.workflowGroups ?? []).find((g) => g.id === groupId)
      if (!group) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: `Workflow group ${groupId} no longer exists on this table`,
        })
        return
      }

      const [workflowRecord] = await db
        .select()
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!workflowRecord || !workflowRecord.isDeployed) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: !workflowRecord ? 'Workflow not found' : 'Workflow is not deployed',
        })
        return
      }

      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
      const startBlock = normalizedData
        ? Object.values(normalizedData.blocks).find((b) => b?.type === 'start_trigger')
        : undefined
      if (!startBlock) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: 'Workflow is missing a Start trigger',
        })
        return
      }

      const row = await getRowById(tableId, rowId, workspaceId)
      if (!row) {
        logger.warn(`Row ${rowId} vanished before execution`)
        return
      }

      // Output columns produced by THIS group are skipped on input — they're
      // populated by the run we're starting. Other group's outputs ARE
      // included (they're plain primitives in `row.data` thanks to the
      // flattened schema).
      const ownOutputColumns = new Set(group.outputs.map((o) => o.columnName))
      const inputRow: Record<string, unknown> = {}
      for (const key of Object.keys(row.data)) {
        if (ownOutputColumns.has(key)) continue
        inputRow[key] = row.data[key]
      }

      const headers = table.schema.columns
        .filter((c) => !ownOutputColumns.has(c.name))
        .map((c) => c.name)

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

      const { pluckByPath } = await import('@/lib/table/pluck')
      const outputsByBlockId = buildOutputsByBlockId(group)

      // Local accumulators for the run.
      const accumulatedData: RowData = {}
      const blockErrors: Record<string, string> = {}
      const runningBlockIds = new Set<string>()
      let writeChain: Promise<void> = Promise.resolve()

      /** Snapshot the current state and append a partial write to the chain. */
      const schedulePartialWrite = () => {
        const dataSnapshot: RowData = { ...accumulatedData }
        const blockErrorsSnapshot = { ...blockErrors }
        const runningSnapshot = Array.from(runningBlockIds)
        writeChain = writeChain
          .then(async () => {
            if (signal?.aborted) return
            await writeState(
              {
                status: 'running',
                executionId,
                // Stamp the jobId from the current row state — the scheduler
                // wrote it before this task started, and we don't want to lose
                // it on partial writes. Re-read defensively.
                jobId: await readJobId(),
                workflowId,
                error: null,
                runningBlockIds: runningSnapshot,
                blockErrors: blockErrorsSnapshot,
              },
              dataSnapshot
            )
          })
          .catch((err) => {
            logger.warn(
              `Per-block partial write failed (table=${tableId} row=${rowId} group=${groupId}):`,
              err
            )
          })
      }

      const readJobId = async (): Promise<string | null> => {
        const r = await getRowById(tableId, rowId, workspaceId)
        const exec = (r?.executions ?? {})[groupId] as RowExecutionMetadata | undefined
        return exec?.jobId ?? null
      }

      const onBlockStart = async (blockId: string): Promise<void> => {
        if (!outputsByBlockId.has(blockId)) return
        runningBlockIds.add(blockId)
        schedulePartialWrite()
      }

      const onBlockComplete = async (blockId: string, output: unknown): Promise<void> => {
        const outputs = outputsByBlockId.get(blockId)
        if (!outputs) return

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
          blockErrors[blockId] = blockErrorMessage
        } else {
          for (const out of outputs) {
            const plucked = pluckByPath(blockResult, out.path)
            accumulatedData[out.columnName] = plucked as RowData[string]
          }
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

      await writeState(
        {
          status: result.success ? 'completed' : 'error',
          executionId,
          jobId: null,
          workflowId,
          error: result.success ? null : (result.error ?? 'Workflow execution failed'),
          runningBlockIds: [],
          blockErrors,
        },
        accumulatedData
      )
    } catch (err) {
      const message = toError(err).message
      logger.error(
        `Workflow group cell execution failed (table=${tableId} row=${rowId} group=${groupId})`,
        { error: message, executionId }
      )
      try {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: message,
        })
      } catch (writeErr) {
        logger.error('Also failed to write error state', { error: toError(writeErr).message })
      }
    }
  })
}

export const workflowGroupCellTask = task({
  id: 'workflow-group-cell',
  machine: 'medium-1x',
  retry: { maxAttempts: 1 },
  // Combined with `concurrencyKey: tableId`, caps each table's sub-queue to
  // 10 in-flight cell jobs while letting different tables run in parallel.
  queue: {
    name: 'workflow-group-cell',
    concurrencyLimit: 10,
  },
  run: (payload: WorkflowGroupCellPayload, { signal }) =>
    executeWorkflowGroupCellJob(payload, signal),
})
