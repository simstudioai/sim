import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

interface WorkspaceFileDisplayRecord {
  id: string
  name: string
  key: string
  path: string
  folderPath?: string | null
}

interface SelectedWorkspaceFileReference {
  id?: string
  name: string
  key?: string
  path?: string
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

/**
 * Matches current picker records by stable identifiers first. Name-only matching remains as a
 * final fallback for saved workflow values created before workspace file IDs were persisted.
 */
export function workspaceFileMatchesSelection(
  workspaceFile: WorkspaceFileDisplayRecord,
  selectedFile: SelectedWorkspaceFileReference
): boolean {
  if (selectedFile.id) return selectedFile.id === workspaceFile.id
  if (selectedFile.key) return selectedFile.key === workspaceFile.key
  if (selectedFile.path?.includes(workspaceFile.key)) return true
  if (selectedFile.folderPath !== undefined) {
    return (
      selectedFile.name === workspaceFile.name &&
      (selectedFile.folderPath ?? null) === (workspaceFile.folderPath ?? null)
    )
  }
  return selectedFile.name === workspaceFile.name
}

export function findSelectedWorkspaceFile(
  workspaceFiles: WorkspaceFileDisplayRecord[],
  selectedFile: SelectedWorkspaceFileReference
): WorkspaceFileDisplayRecord | undefined {
  return workspaceFiles.find((workspaceFile) =>
    workspaceFileMatchesSelection(workspaceFile, selectedFile)
  )
}
