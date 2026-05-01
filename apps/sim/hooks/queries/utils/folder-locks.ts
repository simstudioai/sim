import type { WorkflowFolder } from '@/stores/folders/types'

/**
 * Returns true when the folder or one of its ancestors is locked.
 */
export function isFolderOrAncestorLocked(
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder>
): boolean {
  const visited = new Set<string>()
  let currentFolderId = folderId ?? null

  while (currentFolderId) {
    if (visited.has(currentFolderId)) return false
    visited.add(currentFolderId)

    const folder = folders[currentFolderId]
    if (!folder) return false
    if (folder.locked) return true

    currentFolderId = folder.parentId
  }

  return false
}
