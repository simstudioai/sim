import type { FolderTreeNode, WorkflowFolder } from '@/stores/folders/types'

export function buildFolderMap(folders: WorkflowFolder[]): Record<string, WorkflowFolder> {
  return Object.fromEntries(folders.map((folder) => [folder.id, folder]))
}

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

export function getFolderPath(
  folders: Record<string, WorkflowFolder>,
  folderId: string
): WorkflowFolder[] {
  const path: WorkflowFolder[] = []
  let currentId: string | null = folderId

  while (currentId && folders[currentId]) {
    const folder: WorkflowFolder = folders[currentId]
    path.unshift(folder)
    currentId = folder.parentId
  }

  return path
}
