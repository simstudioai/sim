import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  buildWorkspaceFileFolderPathMap,
  fetchServableWorkspaceFileBuffer,
  listWorkspaceFileFolders,
  listWorkspaceFiles,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  formatFileSize,
  isGeneratedDocumentSourceType,
  isRenderableDocumentName,
  MAX_RENDERED_DOCUMENT_BYTES,
} from '@/lib/uploads/utils/file-utils'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/servable-file-response'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { authorizeWorkspaceFileOperation } from '@/lib/workspace-files/application/workspace-operation-context'

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

function needsRendering(file: WorkspaceFileRecord): boolean {
  return file.type ? isGeneratedDocumentSourceType(file.type) : isRenderableDocumentName(file.name)
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
  principal,
  input,
  request,
}: {
  principal: Principal
  input: DownloadWorkspaceFileItemsInput
  request?: OrchestrationRequestContext
}): Promise<DownloadWorkspaceFileItemsResult> {
  if (input.fileIds.length > MAX_REQUESTED_FILE_IDS) {
    validationError(`Too many file IDs selected. Select ${MAX_REQUESTED_FILE_IDS} or fewer files.`)
  }
  if (input.folderIds.length > MAX_REQUESTED_FOLDER_IDS) {
    validationError(
      `Too many folder IDs selected. Select ${MAX_REQUESTED_FOLDER_IDS} or fewer folders.`
    )
  }
  if (input.fileIds.length === 0 && input.folderIds.length === 0) {
    validationError('No files selected for download')
  }

  const { context } = await authorizeWorkspaceFileOperation(
    principal,
    fileOperations.download,
    input.workspaceId
  )
  const auditAttribution = resolvePrincipalAuditAttribution(principal)
  const [files, folders] = await Promise.all([
    listWorkspaceFiles(context.workspaceId, { hydrateFolderPaths: false, throwOnError: true }),
    listWorkspaceFileFolders(context.workspaceId),
  ])
  const folderPaths = buildWorkspaceFileFolderPathMap(folders)
  const knownFileIds = new Set(files.map((file) => file.id))
  const knownFolderIds = new Set(folders.map((folder) => folder.id))
  if (
    input.fileIds.some((fileId) => !knownFileIds.has(fileId)) ||
    input.folderIds.some((folderId) => !knownFolderIds.has(folderId))
  ) {
    throw new OrchestrationError('not_found', 'File selection not found')
  }
  const selectedFolderIds = collectDescendantFolderIds(input.folderIds, folders)
  const requestedFileIds = new Set(input.fileIds)
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
    .filter((file) => !needsRendering(file))
    .reduce((sum, file) => sum + file.size, 0)
  const renderedDocuments = new Map<string, Buffer>()
  const pendingNames: string[] = []
  let renderedBytes = 0

  for (const file of filesToZip) {
    if (!needsRendering(file)) continue
    const remaining = Math.max(0, MAX_ZIP_DOWNLOAD_BYTES - reservedForStreamed - renderedBytes)
    const allowance = Math.min(remaining, MAX_RENDERED_DOCUMENT_BYTES)
    try {
      const { buffer } = await fetchServableWorkspaceFileBuffer(file, { maxBytes: allowance })
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

  recordAudit({
    workspaceId: context.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    description: `Downloaded ${filesToZip.length} file${filesToZip.length === 1 ? '' : 's'} as zip`,
    metadata: {
      operation: fileOperations.download.id,
      actor: auditAttribution.actor,
      fileCount: filesToZip.length,
      totalBytes: declaredBytes,
    },
    request,
  })

  return { filesToZip, folderPaths, renderedDocuments, declaredBytes }
}

export const downloadWorkspaceFileItems = {
  operation: fileOperations.download,
  execute: executeDownloadWorkspaceFileItems,
} as const
