import { AuditAction, AuditResourceType } from '@sim/audit'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { parseFolderPath } from '@/lib/folders/paths'
import {
  buildWorkspaceFileFolderPathMap,
  listWorkspaceFileFolders,
  listWorkspaceFiles,
  loadWorkspaceFileOperationContext,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import {
  formatFileSize,
  MAX_RENDERED_DOCUMENT_BYTES,
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'

export const MAX_ZIP_DOWNLOAD_BYTES = 250 * 1024 * 1024
const MAX_REQUESTED_FILE_IDS = 1_000
const MAX_REQUESTED_FOLDER_IDS = 1_000

export interface DownloadWorkspaceFileItemsInput {
  workspaceId: string
  fileIds: string[]
  folderIds: string[]
  /**
   * Canonical folder paths, for surfaces that address folders by path rather
   * than by internal id. Resolved against the same folder set the selection
   * already loads, so this costs no additional query.
   */
  folderPaths?: string[]
}

export interface DownloadWorkspaceFileItemsResult {
  filesToZip: WorkspaceFileRecord[]
  folderPaths: Map<string, string>
  renderedDocuments: Map<string, Buffer>
  declaredBytes: number
}

function collectDescendantFolderIds(
  selectedFolderIds: string[],
  folders: Array<{ id: string; parentId: string | null }>
): Set<string> {
  const folderIds = new Set(selectedFolderIds)
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id)
        changed = true
      }
    }
  }
  return folderIds
}

/**
 * Maps canonical folder paths onto the ids the selection walk uses.
 *
 * Resolved against the folder set the download already loads rather than by a
 * separate path query, and a path that matches nothing is rejected rather than
 * silently dropped — a caller that misspells a folder should not receive a zip
 * of whatever else it happened to select.
 */
function resolveFolderIdsFromPaths(
  paths: string[],
  folders: Array<{ id: string }>,
  displayPathById: Map<string, string>
): string[] {
  if (paths.length === 0) return []
  const idByPath = new Map<string, string>()
  for (const folder of folders) {
    const displayPath = displayPathById.get(folder.id)
    if (!displayPath) continue
    idByPath.set(parseWorkspaceFileFolderDisplayPath(displayPath).join('\u0000'), folder.id)
  }
  return paths.map((path) => {
    const id = idByPath.get(parseFolderPath(path).join('\u0000'))
    if (!id) validationError(`Folder not found: ${path}`)
    return id
  })
}

function validationError(message: string): never {
  throw new OrchestrationError('validation', message)
}

async function executeDownloadWorkspaceFileItems({
  input,
  context,
  principal,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.download,
  DownloadWorkspaceFileItemsInput,
  Awaited<ReturnType<typeof resolveDownloadContext>>
>): Promise<DownloadWorkspaceFileItemsResult> {
  const fileIds = [...new Set(input.fileIds)]
  const folderIds = [...new Set(input.folderIds)]
  const requestedFolderPaths = [...new Set(input.folderPaths ?? [])]
  if (fileIds.length > MAX_REQUESTED_FILE_IDS) {
    validationError(`Too many file IDs selected. Select ${MAX_REQUESTED_FILE_IDS} or fewer files.`)
  }
  if (folderIds.length + requestedFolderPaths.length > MAX_REQUESTED_FOLDER_IDS) {
    validationError(
      `Too many folders selected. Select ${MAX_REQUESTED_FOLDER_IDS} or fewer folders.`
    )
  }
  if (fileIds.length === 0 && folderIds.length === 0 && requestedFolderPaths.length === 0) {
    validationError('No files selected for download')
  }

  const [files, folders] = await Promise.all([
    listWorkspaceFiles(context.workspaceId, { hydrateFolderPaths: false, throwOnError: true }),
    listWorkspaceFileFolders(context.workspaceId),
  ])
  const folderPaths = buildWorkspaceFileFolderPathMap(folders)
  const selectedFolderIds = collectDescendantFolderIds(
    [...folderIds, ...resolveFolderIdsFromPaths(requestedFolderPaths, folders, folderPaths)],
    folders
  )
  const requestedFileIds = new Set(fileIds)
  const filesToZip = files.filter(
    (file) =>
      requestedFileIds.has(file.id) ||
      (file.folderId != null && selectedFolderIds.has(file.folderId))
  )

  if (filesToZip.length === 0) validationError('No files selected for download')
  if (filesToZip.length > MAX_ZIP_DOWNLOAD_FILES) {
    validationError(
      `Too many files selected for download. Select ${MAX_ZIP_DOWNLOAD_FILES} or fewer files.`
    )
  }

  const declaredBytes = filesToZip.reduce((sum, file) => sum + file.size, 0)
  if (declaredBytes > MAX_ZIP_DOWNLOAD_BYTES) {
    validationError(
      `Selected files total ${formatFileSize(declaredBytes)}, which exceeds the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit.`
    )
  }

  const reservedForStreamed = filesToZip
    .filter((file) => !needsRenderedArtifact(file.type, file.name))
    .reduce((sum, file) => sum + file.size, 0)
  const renderedDocuments = new Map<string, Buffer>()
  const pendingNames: string[] = []
  let renderedBytes = 0

  for (const file of filesToZip) {
    if (!needsRenderedArtifact(file.type, file.name)) continue
    const remaining = Math.max(0, MAX_ZIP_DOWNLOAD_BYTES - reservedForStreamed - renderedBytes)
    const allowance = Math.min(remaining, MAX_RENDERED_DOCUMENT_BYTES)
    try {
      const { buffer } = await fetchAuthorizedServableWorkspaceFileBuffer(file, principal, {
        maxBytes: allowance,
      })
      renderedBytes += buffer.length
      renderedDocuments.set(file.id, buffer)
    } catch (error) {
      if (error instanceof PayloadSizeLimitError) {
        validationError(
          allowance === MAX_RENDERED_DOCUMENT_BYTES
            ? `"${file.name}" renders to more than ${formatFileSize(MAX_RENDERED_DOCUMENT_BYTES)} and is too large to include in a zip; download it on its own instead.`
            : `The selected files exceed the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit once documents are rendered. Select fewer files.`
        )
      }
      if (!isDocNotReadyError(error)) throw error
      pendingNames.push(file.name)
    }
  }

  if (pendingNames.length > 0) {
    throw new OrchestrationError('conflict', docNotReadyMessage(pendingNames))
  }

  return { filesToZip, folderPaths, renderedDocuments, declaredBytes }
}

async function resolveDownloadContext({ input }: { input: DownloadWorkspaceFileItemsInput }) {
  const context = await loadWorkspaceFileOperationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  const fileIds = [...new Set(input.fileIds)]
  const folderIds = [...new Set(input.folderIds)]
  const folderPaths = [...new Set(input.folderPaths ?? [])]
  /**
   * The authorization resource is the single file only when the request is that
   * one file. A folder — addressed by id or by path — pulls in files the caller
   * never named, so the request is scoped to the workspace instead.
   */
  const addressesOnlyOneFile =
    fileIds.length === 1 && folderIds.length === 0 && folderPaths.length === 0
  return {
    ...context,
    fileId: addressesOnlyOneFile ? fileIds[0] : undefined,
  }
}

export const downloadWorkspaceFileItems = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: resolveDownloadContext,
  execute: executeDownloadWorkspaceFileItems,
  projectAudit({ result }) {
    return {
      action: AuditAction.FILE_DOWNLOADED,
      resourceType: AuditResourceType.FILE,
      description: `Downloaded ${result.filesToZip.length} file${result.filesToZip.length === 1 ? '' : 's'} as zip`,
      metadata: {
        fileCount: result.filesToZip.length,
        totalBytes: result.declaredBytes,
      },
    }
  },
})
