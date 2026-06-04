import type { MothershipResource } from '@/lib/copilot/resource-types'
import { workflowBorderColor } from '@/lib/workspaces/colors'
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

export type SidebarDragGhostIcon =
  | { kind: 'workflow'; color: string }
  | { kind: 'folder' }
  | { kind: 'task' }

const FOLDER_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`

const BLIMP_SVG = `<svg width="14" height="14" viewBox="1.25 1.25 18 18" fill="currentColor" stroke="currentColor" stroke-width="0.75" stroke-linejoin="round" aria-hidden="true"><path transform="translate(20.5, 0) scale(-1, 1)" d="M18.24 9.18C18.16 8.94 18 8.74 17.83 8.56L17.83 8.56C17.67 8.4 17.49 8.25 17.3 8.11V5.48C17.3 5.32 17.24 5.17 17.14 5.06C17.06 4.95 16.93 4.89 16.79 4.89H15.93C15.61 4.89 15.32 5.11 15.19 5.44L14.68 6.77C14.05 6.51 13.23 6.22 12.15 6C11.04 5.77 9.66 5.61 7.9 5.61C5.97 5.61 4.56 6.13 3.61 6.89C3.14 7.28 2.78 7.72 2.54 8.19C2.29 8.66 2.18 9.15 2.18 9.63C2.18 10.1 2.29 10.59 2.52 11.06C2.87 11.76 3.48 12.41 4.34 12.89C4.91 13.2 5.61 13.44 6.43 13.56L6.8 14.78C6.94 15.27 7.33 15.59 7.78 15.59H10.56C11.06 15.59 11.48 15.18 11.58 14.61L11.81 13.29C12.31 13.2 12.75 13.09 13.14 12.99C13.74 12.82 14.24 12.64 14.67 12.48L15.19 13.82C15.32 14.16 15.61 14.38 15.93 14.38H16.79C16.93 14.38 17.06 14.31 17.14 14.2C17.24 14.1 17.29 13.95 17.3 13.79V11.15C17.33 11.12 17.37 11.09 17.42 11.07L17.4 11.07L17.42 11.07C17.65 10.89 17.87 10.69 18.04 10.46C18.12 10.35 18.19 10.22 18.24 10.08C18.29 9.94 18.32 9.79 18.32 9.63C18.32 9.47 18.29 9.32 18.24 9.18Z"/></svg>`

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
      const square = document.createElement('div')
      square.style.cssText = `
        width: 14px; height: 14px; flex-shrink: 0;
        border-radius: 3px; border: 2px solid ${workflowBorderColor(icon.color)};
        background: ${icon.color}; background-clip: padding-box;
      `
      ghost.appendChild(square)
    } else {
      const iconWrapper = document.createElement('div')
      iconWrapper.style.cssText =
        'display: flex; align-items: center; flex-shrink: 0; color: var(--text-icon);'
      iconWrapper.innerHTML = icon.kind === 'folder' ? FOLDER_SVG : BLIMP_SVG
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
