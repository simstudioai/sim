'use client'

import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components'
import { useLogByExecutionId } from '@/hooks/queries/logs'

interface ExecutionDetailsSidebarProps {
  workspaceId: string
  executionId: string | null
  onClose: () => void
}

/**
 * Reuses the logs page's `LogDetails` slideout inside the tables view so a user
 * can inspect a workflow run for a cell without leaving the table. The query is
 * keyed on `executionId` because that's what's stored on the cell.
 */
export function ExecutionDetailsSidebar({
  workspaceId,
  executionId,
  onClose,
}: ExecutionDetailsSidebarProps) {
  const { data: log } = useLogByExecutionId(workspaceId, executionId)
  return <LogDetails log={log ?? null} isOpen={Boolean(executionId)} onClose={onClose} />
}
