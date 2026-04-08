import type { MothershipResource } from '@/lib/copilot/resource-types'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

/**
 * Builds a `MothershipResource` array from a sidebar drag selection so it can
 * be set as `application/x-sim-resources` drag data and dropped into the chat.
 */
export function buildDragResources(
  selection: { workflowIds: string[]; folderIds: string[] },
  workspaceId: string
): MothershipResource[] {
  const allWorkflows = getWorkflows(workspaceId)
  const workflowMap = Object.fromEntries(allWorkflows.map((w) => [w.id, w]))
  const folderMap = getFolderMap(workspaceId)
  return [
    ...selection.workflowIds.map((id) => ({
      type: 'workflow' as const,
      id,
      title: workflowMap[id]?.name ?? id,
    })),
    ...selection.folderIds.map((id) => ({
      type: 'folder' as const,
      id,
      title: folderMap[id]?.name ?? id,
    })),
  ]
}

export function compareByOrder<T extends { sortOrder: number; createdAt?: Date; id: string }>(
  a: T,
  b: T
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const timeA = a.createdAt?.getTime() ?? 0
  const timeB = b.createdAt?.getTime() ?? 0
  if (timeA !== timeB) return timeA - timeB
  return a.id.localeCompare(b.id)
}

export function groupWorkflowsByFolder(
  workflows: WorkflowMetadata[]
): Record<string, WorkflowMetadata[]> {
  const grouped = workflows.reduce(
    (acc, workflow) => {
      const folderId = workflow.folderId || 'root'
      if (!acc[folderId]) acc[folderId] = []
      acc[folderId].push(workflow)
      return acc
    },
    {} as Record<string, WorkflowMetadata[]>
  )
  for (const key of Object.keys(grouped)) {
    grouped[key].sort(compareByOrder)
  }
  return grouped
}
