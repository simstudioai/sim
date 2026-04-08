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

/**
 * Creates a lightweight drag ghost element showing the label of the item(s) being dragged.
 * Append to `document.body`, pass to `e.dataTransfer.setDragImage`, then remove on dragend.
 */
export function createSidebarDragGhost(label: string): HTMLElement {
  const ghost = document.createElement('div')
  ghost.style.cssText = `
    position: fixed;
    top: -500px;
    left: 0;
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    background: var(--surface-active);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: var(--text-body);
    white-space: nowrap;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 9999;
  `
  ghost.textContent = label
  document.body.appendChild(ghost)
  return ghost
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
