import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { tableKeys } from '@/hooks/queries/tables'

const logger = createLogger('useRowExecution')

export interface RunWorkflowColumnParams {
  tableId: string
  rowId: string
  workspaceId: string
  columnName: string
  workflowName?: string
}

interface UseRowExecutionReturn {
  runWorkflowColumn: (params: RunWorkflowColumnParams) => Promise<void>
}

/**
 * Thin client-side wrapper around the manual-run endpoint. Invalidation lives in
 * `finally` so failed starts (4xx/5xx) still refresh the rows query — otherwise a
 * cell stuck in a stale state would remain in the UI until the next refetch.
 */
export function useRowExecution(): UseRowExecutionReturn {
  const queryClient = useQueryClient()

  const runWorkflowColumn = useCallback(
    async (params: RunWorkflowColumnParams) => {
      try {
        const res = await fetch(
          `/api/table/${params.tableId}/rows/${params.rowId}/run-workflow-column`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId: params.workspaceId,
              columnName: params.columnName,
            }),
          }
        )

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to run workflow')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Run workflow column failed:', err)
        toast.error(
          params.workflowName
            ? `Failed to run "${params.workflowName}": ${message}`
            : `Failed to run workflow: ${message}`
        )
      } finally {
        queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(params.tableId) })
      }
    },
    [queryClient]
  )

  return { runWorkflowColumn }
}
