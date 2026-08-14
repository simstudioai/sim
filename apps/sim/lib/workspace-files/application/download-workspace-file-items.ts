import { AuditAction, AuditResourceType } from '@sim/audit'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
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

export const MAX_ZIP_DOWNLOAD_FILES = 100
export const MAX_ZIP_DOWNLOAD_BYTES = 250 * 1024 * 1024
const MAX_REQUESTED_FILE_IDS = 1_000
const MAX_REQUESTED_FOLDER_IDS = 1_000

export interface DownloadWorkspaceFileItemsInput {
  workspaceId: string
  fileIds: string[]
  folderIds: string[]
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
  if (fileIds.length > MAX_REQUESTED_FILE_IDS) {
    validationError(`Too many file IDs selected. Select ${MAX_REQUESTED_FILE_IDS} or fewer files.`)
  }
  if (folderIds.length > MAX_REQUESTED_FOLDER_IDS) {
    validationError(
      `Too many folder IDs selected. Select ${MAX_REQUESTED_FOLDER_IDS} or fewer folders.`
    )
  }
  if (fileIds.length === 0 && folderIds.length === 0) {
    validationError('No files selected for download')
  }

  const [files, folders] = await Promise.all([
    listWorkspaceFiles(context.workspaceId, { hydrateFolderPaths: false, throwOnError: true }),
    listWorkspaceFileFolders(context.workspaceId),
  ])
  const folderPaths = buildWorkspaceFileFolderPathMap(folders)
  const selectedFolderIds = collectDescendantFolderIds(folderIds, folders)
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
  return {
    ...context,
    fileId: fileIds.length === 1 && folderIds.length === 0 ? fileIds[0] : undefined,
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
