import { getErrorMessage } from '@sim/utils/errors'
import { buildFolderPath, FolderPathError, MAX_FOLDER_PATH_BYTES } from '@/lib/folders/paths'
import { normalizeWorkspaceFileItemName } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/vfs/path'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

export interface ParsedWorkspaceFileCreatePath {
  folderSegments: string[]
  fileName: string
  vfsPath: string
}

export const MAX_WORKSPACE_FILE_PATH_BYTES = MAX_FOLDER_PATH_BYTES

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function parseWorkspaceFileSegments(segments: string[]): ParsedWorkspaceFileCreatePath {
  if (segments.length === 0) {
    throw new FolderPathError('Workspace file path must include a file name')
  }

  let fileName: string
  let folderSegments: string[]
  try {
    fileName = normalizeWorkspaceFileItemName(segments.at(-1) ?? '', 'File')
    folderSegments = segments
      .slice(0, -1)
      .map((segment) => normalizeWorkspaceFileItemName(segment, 'Folder'))
  } catch (error) {
    throw new FolderPathError(getErrorMessage(error, 'Invalid workspace file path'))
  }

  buildFolderPath(folderSegments)
  let vfsPath: string
  try {
    vfsPath = `files/${encodeVfsPathSegments([...folderSegments, fileName])}`
  } catch (error) {
    throw new FolderPathError(getErrorMessage(error, 'Invalid workspace file path'))
  }
  if (encodedByteLength(vfsPath) > MAX_WORKSPACE_FILE_PATH_BYTES) {
    throw new FolderPathError(
      `Workspace file paths cannot exceed ${MAX_WORKSPACE_FILE_PATH_BYTES} bytes`
    )
  }

  return { folderSegments, fileName, vfsPath }
}

/**
 * Parses the relative path accepted by file-writing surfaces. Empty slash segments are ignored
 * for compatibility with existing File block workflows, while each effective segment is validated
 * before callers create any folders.
 */
export function parseRelativeWorkspaceFileCreatePath(path: string): ParsedWorkspaceFileCreatePath {
  if (path.includes('\\')) {
    throw new FolderPathError('Workspace file paths cannot contain backslashes')
  }

  const segments = path
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  return parseWorkspaceFileSegments(segments)
}

/** Builds the canonical VFS path for a persisted workspace file record. */
export function workspaceFileVfsPath(file: { folderPath?: string | null; name: string }): string {
  const folderSegments = file.folderPath ? parseWorkspaceFileFolderDisplayPath(file.folderPath) : []
  return `files/${encodeVfsPathSegments([...folderSegments, file.name])}`
}

export function parseWorkspaceFileCreatePath(path: string): ParsedWorkspaceFileCreatePath {
  const trimmed = path.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith('files/')) {
    throw new FolderPathError('Workspace file paths must start with "files/"')
  }

  let decoded: string[]
  try {
    decoded = decodeVfsPathSegments(trimmed.slice('files/'.length))
  } catch (error) {
    throw new FolderPathError(getErrorMessage(error, 'Invalid workspace file path'))
  }
  return parseWorkspaceFileSegments(decoded)
}
