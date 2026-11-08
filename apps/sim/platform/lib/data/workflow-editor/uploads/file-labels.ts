import { formatFileSize } from '@/lib/uploads/utils/file-size'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

/** A file's size through the shared formatter, keeping exact values below one kilobyte. */
export function formatUploadedFileSize(bytes: number): string {
  return formatFileSize(bytes, { includeBytes: true })
}

/**
 * A workspace file's label, prefixed with its folder so two files sharing a name are
 * distinguishable. The stored folder path escapes a slash inside a folder name, so it is decoded
 * into segments rather than split: a folder named `Q3/Q4` stays one level.
 */
export function workspaceFileOptionLabel(file: {
  name: string
  folderPath?: string | null
}): string {
  if (!file.folderPath) return file.name
  try {
    return `${parseWorkspaceFileFolderDisplayPath(file.folderPath).join(' / ')} / ${file.name}`
  } catch {
    return file.name
  }
}
