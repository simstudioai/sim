import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseFolderPath } from '@/lib/folders/paths'
import {
  collectDescendantFolderIdsFrom,
  type FolderNode,
  indexFolderChildren,
} from '@/lib/folders/subtree'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

export interface FileDownloadSelection {
  fileIds: readonly string[]
  folderIds: readonly string[]
  folderPaths?: readonly string[]
}

/** Normalizes the bounded explicit selection before either owner's directory walk. */
export function normalizeFileDownloadSelection(input: FileDownloadSelection) {
  const fileIds = [...new Set(input.fileIds)]
  const folderIds = [...new Set(input.folderIds)]
  const folderPaths = [...new Set(input.folderPaths ?? [])]
  if (fileIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS)
    throw new OrchestrationError(
      'validation',
      `Too many file IDs selected. Select ${MAX_WORKSPACE_FILE_BULK_REQUEST_IDS} or fewer files.`
    )
  if (folderIds.length + folderPaths.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS)
    throw new OrchestrationError(
      'validation',
      `Too many folders selected. Select ${MAX_WORKSPACE_FILE_BULK_REQUEST_IDS} or fewer folders.`
    )
  if (!fileIds.length && !folderIds.length && !folderPaths.length)
    throw new OrchestrationError('validation', 'No files selected for download')
  return { fileIds, folderIds, folderPaths }
}

/** Expands canonical parent relationships, never textual path prefixes. */
export function expandFileDownloadFolders(
  input: FileDownloadSelection,
  folders: readonly FolderNode[],
  displayPaths: ReadonlyMap<string, string>
): Set<string> {
  const selected = new Set(input.folderIds)
  if (input.folderPaths?.length) {
    const byPath = new Map<string, string>()
    for (const folder of folders) {
      const path = displayPaths.get(folder.id)
      if (path) byPath.set(parseWorkspaceFileFolderDisplayPath(path).join('\0'), folder.id)
    }
    for (const path of input.folderPaths) {
      const id = byPath.get(parseFolderPath(path).join('\0'))
      if (!id) throw new OrchestrationError('validation', `Folder not found: ${path}`)
      selected.add(id)
    }
  }
  const children = indexFolderChildren(folders)
  for (const id of [...selected]) {
    for (const descendant of collectDescendantFolderIdsFrom(children, id)) selected.add(descendant)
  }
  return selected
}
