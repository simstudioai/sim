import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

interface WorkspaceFileDisplayRecord {
  id: string
  name: string
  key: string
  path: string
  folderPath?: string | null
}

/** Formats a workspace file as a readable path while keeping root-level labels compact. */
export function getWorkspaceFileDisplayLabel(
  file: Pick<WorkspaceFileDisplayRecord, 'name' | 'folderPath'>
): string {
  if (!file.folderPath) return file.name

  try {
    return [...parseWorkspaceFileFolderDisplayPath(file.folderPath), file.name].join(' / ')
  } catch {
    return `${file.folderPath} / ${file.name}`
  }
}
