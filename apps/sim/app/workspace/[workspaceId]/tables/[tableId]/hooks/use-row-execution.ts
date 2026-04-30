import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import {
  restoreCachedWorkflowCells,
  snapshotAndMutateRows,
  tableKeys,
} from '@/hooks/queries/tables'
import type { RowExecutionMetadata } from '@/lib/table'

const logger = createLogger('useRowExecution')

export interface RunWorkflowGroupParams {
  tableId: string
  rowId: string
  workspaceId: string
  groupId: string
  /** Group's workflow id — used as the optimistic execution's `workflowId`
   *  when the row hasn't run this group before. */
  workflowId: string
  /** Output column names produced by the group; cleared optimistically so
   *  stale values from the previous run don't linger in the UI before the
   *  server response writes the cleared row back. */
  outputColumnNames: string[]
}

interface UseRowExecutionReturn {
  runWorkflowGroup: (params: RunWorkflowGroupParams) => Promise<void>
}

/**
 * Single-row workflow-group runner. Optimistically flips
 * `executions[groupId]` to `pending` for the targeted row before the network
 * round-trip so the spinner appears instantly. Cache invalidation lives in
 * `onSettled` so failed starts still refresh the rows query — otherwise a row
 * stuck in stale state would remain in the UI until the next refetch.
 */
export function useRowExecution(): UseRowExecutionReturn {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (params: RunWorkflowGroupParams) => {
      const res = await fetch(
        `/api/table/${params.tableId}/rows/${params.rowId}/run-workflow-group`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: params.workspaceId,
            groupId: params.groupId,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || 'Failed to run workflow')
      }
      return res.json()
    },
    onMutate: async (params) => {
      logger.info(
        `[FLASH-DEBUG] useRowExecution onMutate row=${params.rowId} group=${params.groupId} clearedCols=${JSON.stringify(params.outputColumnNames)}`
      )
      const snapshots = await snapshotAndMutateRows(queryClient, params.tableId, (r) => {
        if (r.id !== params.rowId) return null
        const exec = (r.executions ?? {})[params.groupId] as RowExecutionMetadata | undefined
        const pending: RowExecutionMetadata = {
          status: 'pending',
          executionId: exec?.executionId ?? null,
          jobId: null,
          workflowId: exec?.workflowId ?? params.workflowId,
          error: null,
        }
        const nextData = { ...r.data }
        for (const colName of params.outputColumnNames) nextData[colName] = null
        return {
          ...r,
          data: nextData,
          executions: { ...(r.executions ?? {}), [params.groupId]: pending },
        }
      })
      return { snapshots }
    },
    onError: (err, _params, context) => {
      if (context?.snapshots) restoreCachedWorkflowCells(queryClient, context.snapshots)
      const message = err instanceof Error ? err.message : 'Unknown error'
      logger.error('Run workflow group failed:', err)
      toast.error(`Failed to run workflow: ${message}`)
    },
    onSettled: (_data, _err, params) => {
      logger.info(`[FLASH-DEBUG] useRowExecution onSettled → invalidate row=${params.rowId}`)
      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(params.tableId) })
    },
  })

  const runWorkflowGroup = useCallback(
    async (params: RunWorkflowGroupParams) => {
      await mutation.mutateAsync(params).catch(() => {
        // onError already toasted; swallow so callers can fire-and-forget.
      })
    },
    // mutateAsync is stable in TanStack Query v5
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return { runWorkflowGroup }
}
