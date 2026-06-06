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

export type SidebarDragGhostIcon = { kind: 'workflow' } | { kind: 'folder' } | { kind: 'task' }

const FOLDER_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`

const WORKFLOW_SVG = `<svg width="14" height="14" viewBox="-1 -2 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.25" y="0.75" width="18" height="18" rx="4"/><rect x="6.25" y="5.75" width="8" height="8" rx="2"/></svg>`

/**
 * Creates a lightweight drag ghost pill showing an icon and label for the item(s) being dragged.
 * Append to `document.body`, pass to `e.dataTransfer.setDragImage`, then remove on dragend.
 */
export function createSidebarDragGhost(label: string, icon?: SidebarDragGhostIcon): HTMLElement {
  const ghost = document.createElement('div')
  ghost.style.cssText = `
    position: fixed;
    top: -500px;
    left: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--surface-active);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: var(--text-body);
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 9999;
  `

  if (icon) {
    if (icon.kind === 'workflow') {
      const iconWrapper = document.createElement('div')
      iconWrapper.style.cssText =
        'display: flex; align-items: center; flex-shrink: 0; color: var(--text-icon);'
      iconWrapper.innerHTML = WORKFLOW_SVG
      ghost.appendChild(iconWrapper)
    } else if (icon.kind === 'task') {
      const circle = document.createElement('div')
      circle.style.cssText = `
        width: 14px; height: 14px; flex-shrink: 0;
        border-radius: 9999px;
        border: 2px solid color-mix(in srgb, var(--text-icon) 38%, transparent);
        background: var(--text-icon); background-clip: padding-box;
      `
      ghost.appendChild(circle)
    } else {
      const iconWrapper = document.createElement('div')
      iconWrapper.style.cssText =
        'display: flex; align-items: center; flex-shrink: 0; color: var(--text-icon);'
      iconWrapper.innerHTML = FOLDER_SVG
      ghost.appendChild(iconWrapper)
    }
  }

  const text = document.createElement('span')
  text.style.cssText = 'max-width: 200px; overflow: hidden; text-overflow: ellipsis;'
  text.textContent = label
  ghost.appendChild(text)

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
