import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { toast } from '@/components/emcn'

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
 * Thin client-side wrapper around the manual-run endpoint.
 * The server handles execution, status transitions, and cell writebacks;
 * the cell itself is the UI feedback, so this hook just kicks off the run.
 */
export function useRowExecution(): UseRowExecutionReturn {
  const runWorkflowColumn = useCallback(async (params: RunWorkflowColumnParams) => {
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
    }
  }, [])

  return { runWorkflowColumn }
}
