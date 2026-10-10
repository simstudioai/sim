import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { compareStrings } from '@sim/utils/string'
import {
  type AuthorizedWorkspaceUseCaseContext,
  capabilityGovernedPrincipalUserId,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
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
import {
  expandFileDownloadFolders,
  normalizeFileDownloadSelection,
} from '@/lib/workspace-files/download-selection'
import { MAX_ZIP_DOWNLOAD_BYTES, MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'
import {
  createFileReadReceipt,
  type FileReadReceipt,
  recheckFileReadReceipt,
} from '@/lib/workspace-files/read-receipt'

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
  const selection = normalizeFileDownloadSelection(input)
  /**
   * permission-group-enforced: files.bulk_download — one operation serves both
   * a single file and a whole folder tree, and only the archive is what the key
   * withholds; declaring the capability on `files.download` would take away
   * saving one file too. `context.fileId` is the same single-file predicate the
   * resource authorization already resolved, reused so the two cannot drift.
   * Asserted against whoever the funnel would have judged, from its own rule —
   * nobody, for a workspace key or an executor run. A run carries the role of
   * whoever triggered it but not their capabilities, and reading the subject
   * straight off the principal would have re-applied here exactly the
   * capability `authorizeWorkspaceOperation` exempts a subject-bearing executor
   * from.
   */
  if (context.fileId === undefined) {
    const actingUserId = capabilityGovernedPrincipalUserId(principal)
    if (actingUserId) {
      await assertWorkspaceCapability(
        actingUserId,
        context.workspaceId,
        'files.bulk_download',
        context.workspaceOrganizationId
      )
    }
  }

  const [files, folders] = await Promise.all([
    listWorkspaceFiles(context.workspaceId, { hydrateFolderPaths: false, throwOnError: true }),
    listWorkspaceFileFolders(context.workspaceId),
  ])
  const folderPaths = buildWorkspaceFileFolderPathMap(folders)
  const selectedFolderIds = expandFileDownloadFolders(selection, folders, folderPaths)
  const requestedFileIds = new Set(selection.fileIds)
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
  const receipts: FileReadReceipt[] = []
  const pendingNames: string[] = []
  let renderedBytes = 0

  for (const file of filesToZip) {
    if (!needsRenderedArtifact(file.type, file.name)) continue
    const remaining = Math.max(0, MAX_ZIP_DOWNLOAD_BYTES - reservedForStreamed - renderedBytes)
    const allowance = Math.min(remaining, MAX_RENDERED_DOCUMENT_BYTES)
    try {
      const { buffer, receipt } = await fetchAuthorizedServableWorkspaceFileBuffer(
        file,
        principal,
        {
          maxBytes: allowance,
        }
      )
      receipts.push(receipt)
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

  await downloadWorkspaceFileItems.authorize({ principal, input })
  if (context.fileId === undefined) {
    const actingUserId = capabilityGovernedPrincipalUserId(principal)
    if (actingUserId) {
      // permission-group-enforced: files.bulk_download — publication must use the current archive capability.
      await assertWorkspaceCapability(
        actingUserId,
        context.workspaceId,
        'files.bulk_download',
        context.workspaceOrganizationId
      )
    }
  }
  const [currentFiles, currentFolders] = await Promise.all([
    listWorkspaceFiles(context.workspaceId, { hydrateFolderPaths: false, throwOnError: true }),
    listWorkspaceFileFolders(context.workspaceId),
  ])
  const currentPaths = buildWorkspaceFileFolderPathMap(currentFolders)
  const currentSelection = expandFileDownloadFolders(selection, currentFolders, currentPaths)
  const currentSelectedFiles = currentFiles.filter(
    (file) =>
      requestedFileIds.has(file.id) ||
      (file.folderId != null && currentSelection.has(file.folderId))
  )
  const identity = (selected: WorkspaceFileRecord[], paths: Map<string, string>) =>
    JSON.stringify(
      [...selected]
        .sort((a, b) => compareStrings(a.id, b.id))
        .map((file) => [
          file.id,
          file.key,
          file.name,
          file.folderId,
          file.folderId ? paths.get(file.folderId) : null,
        ])
    )
  if (identity(currentSelectedFiles, currentPaths) !== identity(filesToZip, folderPaths))
    throw new OrchestrationError('conflict', 'File selection changed while preparing the download')
  receipts.push(
    createFileReadReceipt(
      { entityType: 'workspace', entityId: context.workspaceId },
      filesToZip.map((file) => ({
        ...file,
        contentUpdatedAt: file.contentUpdatedAt ?? file.updatedAt,
      }))
    )
  )
  await db.transaction(async (tx) => {
    for (const receipt of receipts) await recheckFileReadReceipt(tx, receipt)
  })
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
