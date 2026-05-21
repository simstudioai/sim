import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { withCascadeLock } from '@/lib/table/cascade-lock'
import type {
  RowData,
  RowExecutionMetadata,
  TableDefinition,
  WorkflowGroup,
} from '@/lib/table/types'
import type { WorkflowGroupCellPayload } from '@/lib/table/workflow-columns'

export type { WorkflowGroupCellPayload }

const logger = createLogger('TriggerWorkflowGroupCell')

/** Cell-task entrypoint. Holds a per-row cascade lock so only one worker
 *  advances a given row at a time; bails on contention. The held lock heart-
 *  beats every 10s so a crashed pod releases within ~30s. */
export async function executeWorkflowGroupCellJob(
  payload: WorkflowGroupCellPayload,
  signal?: AbortSignal
) {
  const { tableId, rowId, executionId } = payload
  const outcome = await withCascadeLock(tableId, rowId, executionId, () =>
    runRowCascadeLoop(payload, signal)
  )
  if (outcome.status === 'contended') {
    logger.info(
      `Cascade lock held — bailing (table=${tableId} row=${rowId} executionId=${executionId})`
    )
  }
}

/** Re-fetches the table schema each iteration so groups added DURING the
 *  cascade become visible to the eligibility check. The resume worker must
 *  already hold the row's cascade lock before calling. */
export async function runRowCascadeLoop(
  payload: WorkflowGroupCellPayload,
  signal?: AbortSignal
): Promise<void> {
  const { tableId, rowId, workspaceId } = payload
  const { getTableById, getRowById } = await import('@/lib/table/service')
  const { pickNextEligibleGroupForRow } = await import('@/lib/table/workflow-columns')

  let currentGroupId = payload.groupId
  let currentWorkflowId = payload.workflowId
  // Fresh executionId per iteration: SQL guard rejects writes whose id ≠
  // row.executions[gid].executionId, so we need a new claim per group.
  let currentExecutionId = payload.executionId

  while (true) {
    if (signal?.aborted) break

    const freshTable = await getTableById(tableId)
    if (!freshTable) {
      logger.warn(`Table ${tableId} vanished mid-cascade`)
      break
    }
    const currentGroup = freshTable.schema.workflowGroups?.find((g) => g.id === currentGroupId)
    if (!currentGroup) {
      logger.warn(`Group ${currentGroupId} no longer exists on table ${tableId}`)
      break
    }

    const result = await runWorkflowAndWriteTerminal(
      {
        ...payload,
        groupId: currentGroupId,
        workflowId: currentWorkflowId,
        executionId: currentExecutionId,
      },
      signal,
      freshTable,
      currentGroup
    )

    if (result === 'paused') break

    const freshRow = await getRowById(tableId, rowId, workspaceId)
    if (!freshRow) break
    const next = pickNextEligibleGroupForRow(freshTable, freshRow, currentGroupId)
    if (!next) break
    currentGroupId = next.id
    currentWorkflowId = next.workflowId
    currentExecutionId = generateId()
  }
}

/** Returns `'paused'` to signal the cascade loop must exit (resume worker
 *  takes over). `'completed' | 'error'` keep the loop running. */
async function runWorkflowAndWriteTerminal(
  payload: WorkflowGroupCellPayload,
  signal: AbortSignal | undefined,
  table: TableDefinition,
  group: WorkflowGroup
): Promise<'completed' | 'error' | 'paused'> {
  const { tableId, tableName, rowId, groupId, workflowId, workspaceId, executionId } = payload
  const requestId = `wfgrp-${executionId}`

  return runWithRequestContext({ requestId }, async () => {
    const { getRowById } = await import('@/lib/table/service')
    const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')
    const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
    const { writeWorkflowGroupState, markWorkflowGroupPickedUp, buildOutputsByBlockId } =
      await import('@/lib/table/cell-write')
    const { stashCellContextForResume } = await import('@/lib/table/workflow-columns')

    const cellCtx = { tableId, rowId, workspaceId, groupId, executionId, requestId }
    const writeState = (executionState: RowExecutionMetadata, dataPatch?: RowData) =>
      writeWorkflowGroupState(cellCtx, { executionState, dataPatch })

    const blockErrors: Record<string, string> = {}
    let writeChain: Promise<void> = Promise.resolve()
    let terminalWritten = false

    try {
      const [workflowRecord] = await db
        .select()
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: 'Workflow not found',
        })
        return 'error'
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
        return 'error'
      }

      const row = await getRowById(tableId, rowId, workspaceId)
      if (!row) {
        logger.warn(`Row ${rowId} vanished before execution`)
        return 'error'
      }

      // SQL guard rejects if a stop click stamped `cancelled` between enqueue
      // and pickup.
      const pickedUp = await markWorkflowGroupPickedUp(cellCtx, {
        workflowId,
        jobId: null,
      })
      if (pickedUp === 'skipped') return 'error'

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

      const accumulatedData: RowData = {}
      const runningBlockIds = new Set<string>()

      const schedulePartialWrite = () => {
        if (terminalWritten) return
        const dataSnapshot: RowData = { ...accumulatedData }
        const blockErrorsSnapshot = { ...blockErrors }
        const runningSnapshot = Array.from(runningBlockIds)
        writeChain = writeChain
          .then(async () => {
            if (signal?.aborted) return
            if (terminalWritten) return
            await writeState(
              {
                status: 'running',
                executionId,
                jobId: null,
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

      const onBlockStart = async (blockId: string): Promise<void> => {
        if (!outputsByBlockId.has(blockId)) return
        runningBlockIds.add(blockId)
        schedulePartialWrite()
      }

      const onBlockComplete = async (blockId: string, output: unknown): Promise<void> => {
        const outputs = outputsByBlockId.get(blockId)
        if (!outputs) return

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
            if (plucked === undefined) continue
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
          useDraftState: true,
          abortSignal: signal,
          onBlockStart,
          onBlockComplete,
        },
        executionId
      )

      terminalWritten = true
      await writeChain.catch(() => {})

      if (result.status === 'paused') {
        await writeState(
          {
            status: 'pending',
            executionId,
            jobId: `paused-${executionId}`,
            workflowId,
            error: null,
            runningBlockIds: [],
            blockErrors,
          },
          accumulatedData
        )
        await stashCellContextForResume({
          executionId,
          tableId,
          tableName,
          rowId,
          groupId,
          workflowId,
          workspaceId,
        })
        return 'paused'
      }

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
      return result.success ? 'completed' : 'error'
    } catch (err) {
      const message = toError(err).message
      logger.error(
        `Workflow group cell execution failed (table=${tableId} row=${rowId} group=${groupId})`,
        { error: message, executionId }
      )
      terminalWritten = true
      await writeChain.catch(() => {})
      try {
        await writeState({
          status: 'error',
          executionId,
          jobId: null,
          workflowId,
          error: message,
          runningBlockIds: [],
          blockErrors,
        })
      } catch (writeErr) {
        logger.error('Also failed to write error state', { error: toError(writeErr).message })
      }
      return 'error'
    }
  })
}

export const workflowGroupCellTask = task({
  id: 'workflow-group-cell',
  machine: 'medium-1x',
  retry: { maxAttempts: 1 },
  // Combined with `concurrencyKey: tableId`, caps each table's sub-queue to
  // 20 in-flight cell jobs while letting different tables run in parallel.
  queue: {
    name: 'workflow-group-cell',
    concurrencyLimit: 20,
  },
  run: (payload: WorkflowGroupCellPayload, { signal }) =>
    executeWorkflowGroupCellJob(payload, signal),
})
