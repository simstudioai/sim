import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { tableKeys } from '@/hooks/queries/tables'

const logger = createLogger('useRowExecution')

export interface RunWorkflowGroupParams {
  tableId: string
  rowId: string
  workspaceId: string
  groupId: string
}

interface UseRowExecutionReturn {
  runWorkflowGroup: (params: RunWorkflowGroupParams) => Promise<void>
}

/**
 * Thin client-side wrapper around the manual-run endpoint. Invalidation lives
 * in `finally` so failed starts (4xx/5xx) still refresh the rows query —
 * otherwise a row stuck in stale state would remain in the UI until the next
 * refetch.
 */
export function useRowExecution(): UseRowExecutionReturn {
  const queryClient = useQueryClient()

  const runWorkflowGroup = useCallback(
    async (params: RunWorkflowGroupParams) => {
      try {
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
          throw new Error(body.error || 'Failed to run workflow')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Run workflow group failed:', err)
        toast.error(`Failed to run workflow: ${message}`)
      } finally {
        queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(params.tableId) })
      }
    },
    [queryClient]
  )

  return { runWorkflowGroup }
}
