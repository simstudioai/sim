import { buildFolderPath, parentFolderPath, parseFolderPath } from '@/lib/folders/paths'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

/**
 * Projects a stored folder onto the wire shape.
 *
 * Shared rather than copied per route: the second copy was written without the
 * name/path invariant below, so the same row that made the list read fail loudly
 * would have been served with a mismatched `name` and `path` from the restore
 * read. One definition means one answer.
 */
export function toV2Folder(folder: {
  name: string
  path: string
  createdAt: Date
  updatedAt: Date
}) {
  const segments = folder.path.startsWith('/')
    ? parseFolderPath(folder.path)
    : parseWorkspaceFileFolderDisplayPath(folder.path)
  if (segments.at(-1) !== folder.name) {
    throw new Error('Workspace file folder path does not match its folder name')
  }
  const path = buildFolderPath(segments)
  return {
    name: folder.name,
    path,
    parentPath: parentFolderPath(path),
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  }
}
