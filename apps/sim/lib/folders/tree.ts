import type { Folder, FolderTreeNode } from '@/stores/folders/types'

export function buildFolderMap(folders: Folder[]): Record<string, Folder> {
  return Object.fromEntries(folders.map((folder) => [folder.id, folder]))
}

export function buildFolderTree(
  folders: Record<string, Folder>,
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
  folders: Record<string, Folder>,
  folderId: string
): Folder | undefined {
  return folders[folderId]
}

export function getChildFolders(
  folders: Record<string, Folder>,
  parentId: string | null
): Folder[] {
  return Object.values(folders)
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export function getFolderPath(folders: Record<string, Folder>, folderId: string): Folder[] {
  const path: Folder[] = []
  let currentId: string | null = folderId

  while (currentId && folders[currentId]) {
    const folder: Folder = folders[currentId]
    path.unshift(folder)
    currentId = folder.parentId
  }

  return path
}
