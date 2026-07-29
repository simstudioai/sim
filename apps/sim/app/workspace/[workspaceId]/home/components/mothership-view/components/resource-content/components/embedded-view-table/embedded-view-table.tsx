'use client'

import { parseTableViewResourceId } from '@/lib/copilot/resources/types'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/table'

interface EmbeddedViewTableProps {
  workspaceId: string
  resourceId: string
  viewsEnabled?: boolean
}

/** Renders a persisted View resource through its live source Table. */
export function EmbeddedViewTable({
  workspaceId,
  resourceId,
  viewsEnabled = false,
}: EmbeddedViewTableProps) {
  const parsed = parseTableViewResourceId(resourceId)
  if (!parsed) return null
  return (
    <Table
      workspaceId={workspaceId}
      tableId={parsed.tableId}
      viewId={parsed.viewId}
      embedded
      viewsEnabled={viewsEnabled}
    />
  )
}
