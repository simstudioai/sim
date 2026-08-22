import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { normalizeWorkspaceFileItemName } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'

export function parseWorkspaceFileCreatePath(path: string): {
  folderSegments: string[]
  fileName: string
  vfsPath: string
} {
  const trimmed = path.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith('files/')) {
    throw new Error('Workspace file paths must start with "files/"')
  }

  const decoded = decodeVfsPathSegments(trimmed.slice('files/'.length))
  if (decoded.length === 0) {
    throw new Error('Workspace file path must include a file name')
  }

  const fileName = normalizeWorkspaceFileItemName(decoded.at(-1) ?? '', 'File')
  const folderSegments = decoded
    .slice(0, -1)
    .map((segment) => normalizeWorkspaceFileItemName(segment, 'Folder'))

  return {
    folderSegments,
    fileName,
    vfsPath: canonicalWorkspaceFilePath({ folderPath: folderSegments.join('/'), name: fileName }),
  }
}
