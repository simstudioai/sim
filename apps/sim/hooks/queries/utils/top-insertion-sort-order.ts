interface SortableWorkflow {
  workspaceId: string
  folderId?: string | null
  sortOrder?: number
}

interface SortableFolder {
  workspaceId: string
  parentId?: string | null
  sortOrder: number
}

/**
 * Calculates the insertion sort order that places a new item at the top of a
 * mixed list of folders and workflows within the same parent scope.
 */
export function getTopInsertionSortOrder(
  workflows: Record<string, SortableWorkflow>,
  folders: Record<string, SortableFolder>,
  workspaceId: string,
  parentId: string | null | undefined
): number {
  const normalizedParentId = parentId ?? null

  const siblingWorkflows = Object.values(workflows).filter(
    (workflow) =>
      workflow.workspaceId === workspaceId && (workflow.folderId ?? null) === normalizedParentId
  )
  const siblingFolders = Object.values(folders).filter(
    (folder) =>
      folder.workspaceId === workspaceId && (folder.parentId ?? null) === normalizedParentId
  )

  const siblingOrders = [
    ...siblingWorkflows.map((workflow) => workflow.sortOrder ?? 0),
    ...siblingFolders.map((folder) => folder.sortOrder),
  ]

  if (siblingOrders.length === 0) {
    return 0
  }

  return Math.min(...siblingOrders) - 1
}
