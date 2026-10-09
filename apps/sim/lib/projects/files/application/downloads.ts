import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import { compareStrings } from '@sim/utils/string'
import { and, asc, inArray, isNull, or } from 'drizzle-orm'
import JSZip from 'jszip'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import type { DbTransaction } from '@/lib/db/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { readProjectFileArtifact } from '@/lib/projects/files/application/artifacts'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  buildWorkspaceFileFolderPathMap,
  loadActiveFileFolderPathIndex,
  mapFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { extractEmbeddedFileRefs } from '@/lib/uploads/server/embedded-image-refs'
import {
  createMarkdownExport,
  MAX_EXPORT_ASSET_BYTES,
  MAX_EXPORT_TOTAL_BYTES,
  type MarkdownExportAsset,
  type MarkdownExportResult,
  MarkdownExportSizeError,
} from '@/lib/uploads/server/markdown-export'
import { bufferZipWithinLimit } from '@/lib/uploads/server/zip'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { storedFileId } from '@/lib/uploads/utils/embedded-image-ref'
import {
  isMarkdownFile,
  MAX_RENDERED_DOCUMENT_BYTES,
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file-utils'
import { normalizeMimeType } from '@/lib/uploads/utils/mime'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import {
  observeWorkspaceFileDelivery,
  reportWorkspaceFileDelivery,
} from '@/lib/workspace-files/application/file-delivery-observer'
import {
  expandFileDownloadFolders,
  normalizeFileDownloadSelection,
} from '@/lib/workspace-files/download-selection'
import { MAX_ZIP_DOWNLOAD_BYTES, MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import {
  createFileReadReceipt,
  type FileReadReceipt,
  recheckFileReadReceipt,
} from '@/lib/workspace-files/read-receipt'

const logger = createLogger('ProjectFileDownloads')

export interface DownloadProjectFileItemsInput extends ProjectFileTarget {
  fileIds: string[]
  folderIds: string[]
}

interface DownloadResult {
  buffer: Buffer
  fileName: string
  contentType: 'application/zip'
  fileCount: number
  secretProvenance: WorkspaceFileSecretProvenance
}

export interface ExportProjectFileSnapshotInput extends ProjectFileTarget {
  fileId: string
  content: string
  /** Host evidence for an agent's visible snapshot; never accepted by HTTP contracts. */
  secretProvenance?: WorkspaceFileSecretProvenance
}

async function requireDownloadCapability(
  tx: DbTransaction,
  principal: Principal,
  context: ProjectFileAuthorizationContext,
  input: DownloadProjectFileItemsInput
) {
  const selection = normalizeFileDownloadSelection(input)
  if (selection.fileIds.length === 1 && !selection.folderIds.length) return selection
  for (const workspaceId of context.visibleWorkspaceIds) {
    // permission-group-enforced: files.bulk_download — all accessible active environments govern an archive.
    await assertWorkspaceCapability(
      requirePrincipalSubjectUserId(principal),
      workspaceId,
      'files.bulk_download',
      context.organizationId,
      tx
    )
  }
  return selection
}

async function snapshotSelection(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  input: DownloadProjectFileItemsInput
) {
  const selection = normalizeFileDownloadSelection(input)
  const index = await loadActiveFileFolderPathIndex(context.owner, tx, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
  const folders = [...index.rowById.values()]
  const paths = buildWorkspaceFileFolderPathMap(folders)
  if (selection.folderIds.some((id) => !index.rowById.has(id)))
    throw new OrchestrationError('not_found', 'Folder not found')
  const folderIds = expandFileDownloadFolders(selection, folders, paths)
  const files = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(context.owner),
        isNull(workspaceFiles.deletedAt),
        or(
          selection.fileIds.length ? inArray(workspaceFiles.id, selection.fileIds) : undefined,
          folderIds.size ? inArray(workspaceFiles.folderId, [...folderIds]) : undefined
        )
      )
    )
    .orderBy(asc(workspaceFiles.id))
    .limit(MAX_ZIP_DOWNLOAD_FILES + 1)
    .for('share')
  if (files.length > MAX_ZIP_DOWNLOAD_FILES)
    throw new OrchestrationError(
      'validation',
      `Too many files selected for download. Select ${MAX_ZIP_DOWNLOAD_FILES} or fewer files.`
    )
  const ids = new Set(files.map((file) => file.id))
  if (selection.fileIds.some((id) => !ids.has(id)))
    throw new OrchestrationError('not_found', 'File not found')
  if (!files.length) throw new OrchestrationError('validation', 'No files selected for download')
  const bytes = files.reduce((total, file) => total + getWorkspaceFileSize(file), 0)
  assertKnownSizeWithinLimit(bytes, MAX_ZIP_DOWNLOAD_BYTES, 'selected files')
  const identity = JSON.stringify({
    folders: folders
      .filter((folder) => folderIds.has(folder.id))
      .sort((left, right) => compareStrings(left.id, right.id))
      .map((folder) => [folder.id, folder.name, folder.parentId]),
    files: files.map((file) => [
      file.id,
      file.key,
      file.contentUpdatedAt.getTime(),
      file.originalName,
      file.folderId,
      file.folderId ? paths.get(file.folderId) : null,
    ]),
  })
  return { files, paths, identity }
}

const snapshotDownload = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.downloadItems,
  DownloadProjectFileItemsInput,
  Awaited<ReturnType<typeof snapshotSelection>>
>({
  operation: projectFileOperations.downloadItems,
  async execute({ principal, input, context, tx }) {
    await requireDownloadCapability(tx, principal, context, input)
    return snapshotSelection(tx, context, input)
  },
})

interface PreparedDownload {
  identity: string
  receipts: FileReadReceipt[]
  buffer: Buffer
  fileCount: number
}

/** A bounded archive is published only after the selected tree and all rendered inputs remain current. */
export const downloadProjectFileItems = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.downloadItems,
  DownloadProjectFileItemsInput,
  DownloadResult,
  PreparedDownload
>({
  operation: projectFileOperations.downloadItems,
  async prepare({ principal, input, context }) {
    try {
      const selection = await snapshotDownload.execute({ principal, input })
      const zip = new JSZip()
      const receipts: FileReadReceipt[] = []
      const paths = buildZipEntryPaths(
        selection.files.map((file) => ({
          name: file.originalName,
          contentType: file.contentType,
          folderPath: file.folderId ? selection.paths.get(file.folderId) : null,
        }))
      )
      let remaining = MAX_ZIP_DOWNLOAD_BYTES
      for (const [index, file] of selection.files.entries()) {
        let buffer: Buffer
        if (
          needsRenderedArtifact(file.contentType, file.originalName) ||
          file.contentType === SIM_PAGE_CONTENT_TYPE ||
          file.originalName.toLowerCase().endsWith('.html')
        ) {
          const rendered = await observeWorkspaceFileDelivery(
            async () => {},
            () =>
              readProjectFileArtifact.execute({
                principal,
                input: {
                  projectId: context.projectId,
                  fileId: file.id,
                  maxBytes: Math.min(remaining, MAX_RENDERED_DOCUMENT_BYTES),
                },
              })
          )
          buffer = rendered.buffer
          receipts.push(rendered.receipt)
        } else {
          buffer = await downloadFile({ key: file.key, context: 'project', maxBytes: remaining })
          receipts.push(createFileReadReceipt(context.owner, [file]))
        }
        assertKnownSizeWithinLimit(buffer.length, remaining, 'selected files')
        remaining -= buffer.length
        zip.file(paths[index], buffer)
      }
      return {
        identity: selection.identity,
        receipts,
        fileCount: selection.files.length,
        buffer: await bufferZipWithinLimit(zip, MAX_ZIP_DOWNLOAD_BYTES),
      }
    } catch (error) {
      throw asOrchestrationError(error) ?? error
    }
  },
  async execute({ principal, input, context, tx, prepared }) {
    if (!prepared) throw new Error('Prepared archive is unavailable')
    await requireDownloadCapability(tx, principal, context, input)
    const selection = await snapshotSelection(tx, context, input)
    if (selection.identity !== prepared.identity)
      throw new OrchestrationError(
        'conflict',
        'File selection changed while preparing the download'
      )
    const evidence: WorkspaceFileSecretProvenance[] = []
    for (const receipt of prepared.receipts)
      evidence.push(await recheckFileReadReceipt(tx, receipt))
    return {
      buffer: prepared.buffer,
      fileName: 'project-files.zip',
      contentType: 'application/zip',
      fileCount: prepared.fileCount,
      secretProvenance: mergeWorkspaceFileSecretProvenance(...evidence),
    }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    description: `Downloaded ${result.fileCount} Project files as zip`,
    metadata: {
      projectId: context.projectId,
      fileCount: result.fileCount,
      totalBytes: result.buffer.length,
    },
  }),
})

interface SnapshotAssets {
  source: WorkspaceFileRow
  assets: { reference: string; file: WorkspaceFileRow }[]
}

const snapshotMarkdownAssets = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.exportSnapshot,
  ExportProjectFileSnapshotInput,
  SnapshotAssets
>({
  operation: projectFileOperations.exportSnapshot,
  async execute({ input, context, tx }) {
    const source = context.file
    if (!source) throw new OrchestrationError('not_found', 'File not found')
    if (
      !isMarkdownFile({ name: source.originalName, type: source.contentType }) &&
      normalizeMimeType(source.contentType) !== 'text/x-markdown'
    )
      throw new OrchestrationError('validation', 'Only Markdown files support snapshot export')
    if (
      utf8ByteLength(input.content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) >
      PASTE_LIMITS.RICH_MARKDOWN_BYTES
    )
      throw new OrchestrationError('validation', 'Markdown snapshot is too large')
    const references = extractEmbeddedFileRefs(input.content, context.owner)
    if (!references.ids.length && !references.keys.length) return { source, assets: [] }
    const rows = await tx
      .select()
      .from(workspaceFiles)
      .where(
        and(
          fileOwnerCondition(context.owner),
          isNull(workspaceFiles.deletedAt),
          or(
            references.ids.length
              ? inArray(workspaceFiles.id, references.ids.map(storedFileId))
              : undefined,
            references.keys.length ? inArray(workspaceFiles.key, references.keys) : undefined
          )
        )
      )
      .orderBy(asc(workspaceFiles.id))
      .for('share')
    const byId = new Map(rows.map((file) => [file.id, file]))
    const byKey = new Map(rows.map((file) => [file.key, file]))
    const assets: SnapshotAssets['assets'] = []
    for (const reference of references.ids) {
      const file = byId.get(storedFileId(reference))
      if (file) assets.push({ reference, file })
    }
    for (const reference of references.keys) {
      const file = byKey.get(reference)
      if (file) assets.push({ reference, file })
    }
    return { source, assets }
  },
})

interface PreparedSnapshot {
  receipt: FileReadReceipt
  export: MarkdownExportResult
}

/** Exports the visible snapshot without advancing the durable file or collaborative document. */
export const exportProjectFileSnapshot = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.exportSnapshot,
  ExportProjectFileSnapshotInput,
  MarkdownExportResult & {
    file: ReturnType<typeof mapFileRecord>
    secretProvenance: WorkspaceFileSecretProvenance
  },
  PreparedSnapshot
>({
  operation: projectFileOperations.exportSnapshot,
  async prepare({ principal, input, context }) {
    const snapshot = await snapshotMarkdownAssets.execute({ principal, input })
    const content = Buffer.from(input.content)
    const assets: MarkdownExportAsset[] = []
    const consumed: WorkspaceFileRow[] = [snapshot.source]
    let actualBytes = content.length
    try {
      assertKnownSizeWithinLimit(
        content.length +
          snapshot.assets.reduce((total, { file }) => total + getWorkspaceFileSize(file), 0),
        MAX_EXPORT_TOTAL_BYTES,
        'Markdown export'
      )
      for (const asset of snapshot.assets) {
        let buffer: Buffer
        try {
          buffer = await downloadFile({
            key: asset.file.key,
            context: 'project',
            maxBytes: MAX_EXPORT_ASSET_BYTES,
          })
        } catch (error) {
          logger.warn('Skipped unavailable Markdown export asset', { fileId: asset.file.id, error })
          continue
        }
        actualBytes += buffer.length
        assertKnownSizeWithinLimit(actualBytes, MAX_EXPORT_TOTAL_BYTES, 'Markdown export')
        assets.push({
          imageId: asset.reference,
          key: asset.file.key,
          context: 'project',
          originalName: asset.file.originalName,
          size: buffer.length,
          buffer,
        })
        consumed.push(asset.file)
      }
      return {
        receipt: createFileReadReceipt(context.owner, consumed),
        export: await createMarkdownExport({
          content,
          fileName: snapshot.source.originalName,
          owner: context.owner,
          assets,
        }),
      }
    } catch (error) {
      if (error instanceof MarkdownExportSizeError)
        throw new OrchestrationError('validation', error.message)
      throw asOrchestrationError(error) ?? error
    }
  },
  async execute({ principal, input, context, tx, prepared }) {
    if (!prepared || !context.file) throw new Error('Prepared Markdown export is unavailable')
    const evidence = await recheckFileReadReceipt(tx, prepared.receipt)
    const secretProvenance = mergeWorkspaceFileSecretProvenance(
      evidence,
      input.secretProvenance ??
        (principal.kind === 'resource_delegated'
          ? { status: 'unknown' }
          : { status: 'exact', entries: [] })
    )
    const index = await loadActiveFileFolderPathIndex(context.owner, tx, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return {
      ...prepared.export,
      secretProvenance,
      file: mapFileRecord(
        context.file,
        context.owner,
        buildWorkspaceFileFolderPathMap([...index.rowById.values()])
      ),
    }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Exported Project file "${result.file.name}"`,
    metadata: {
      projectId: context.projectId,
      bytes: result.buffer.length,
      format: result.format,
      assetCount: result.assetCount,
    },
  }),
})
