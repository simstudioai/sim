import type { FolderTreeNode, WorkflowFolder } from '@/stores/folders/types'

export function buildFolderTree(
  folders: Record<string, WorkflowFolder>,
  workspaceId: string
): FolderTreeNode[] {
  const workspaceFolders = Object.values(folders).filter(
    (folder) => folder.workspaceId === workspaceId
  )

  const buildTree = (parentId: string | null, level = 0): FolderTreeNode[] => {
    return workspaceFolders
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((folder) => ({
        ...folder,
        children: buildTree(folder.id, level + 1),
        level,
      }))
  }

  return buildTree(null)
}

export function getFolderById(
  folders: Record<string, WorkflowFolder>,
  folderId: string
): WorkflowFolder | undefined {
  return folders[folderId]
}

export function getChildFolders(
  folders: Record<string, WorkflowFolder>,
  parentId: string | null
): WorkflowFolder[] {
  return Object.values(folders)
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/**
 * Root-first ancestor chain of `folderId`, as folder objects — callers need the ids (cycle
 * checks, expanding each ancestor), not just the names, which is why this is distinct from
 * the string-returning `getFolderPath` in `@/hooks/queries/utils/folder-tree`.
 *
 * `visited` is not defensive padding. The client folder map is written optimistically by
 * `useReorderFolders`, which sets `parentId` without validating the result, so a cycle is
 * reachable in cache even though the server rejects one. Without the guard this loops
 * forever and hangs the tab.
 */
export function getFolderPath(
  folders: Record<string, WorkflowFolder>,
  folderId: string
): WorkflowFolder[] {
  const path: WorkflowFolder[] = []
  const visited = new Set<string>()
  let currentId: string | null = folderId

  while (currentId && folders[currentId] && !visited.has(currentId)) {
    visited.add(currentId)
    const folder: WorkflowFolder = folders[currentId]
    path.unshift(folder)
    currentId = folder.parentId
  }

  return path
}
