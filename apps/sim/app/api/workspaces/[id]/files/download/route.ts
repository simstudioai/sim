import { Readable } from 'node:stream'
import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { ZipArchive } from 'archiver'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  DOCXJS_SOURCE_MIME,
  PPTXGENJS_SOURCE_MIME,
  PYTHON_PDF_SOURCE_MIME,
  PYTHON_XLSX_SOURCE_MIME,
} from '@/lib/copilot/tools/server/files/doc-compile'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  buildWorkspaceFileFolderPathMap,
  fetchServableWorkspaceFileBuffer,
  listWorkspaceFileFolders,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import {
  formatFileSize,
  isRenderableDocumentName,
  MAX_RENDERED_DOCUMENT_BYTES,
} from '@/lib/uploads/utils/file-utils'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/servable-file-response'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('WorkspaceFilesDownloadAPI')
const MAX_ZIP_DOWNLOAD_FILES = 100
const MAX_ZIP_DOWNLOAD_BYTES = 250 * 1024 * 1024

/** Content types under which a generated document's *source* is stored. */
const GENERATED_SOURCE_TYPES = new Set<string>([
  DOCXJS_SOURCE_MIME,
  PPTXGENJS_SOURCE_MIME,
  PYTHON_PDF_SOURCE_MIME,
  PYTHON_XLSX_SOURCE_MIME,
])

/**
 * Whether this entry's stored bytes are a generation source that has to be resolved
 * before it can go in the archive. An ordinary uploaded `.docx` serves exactly what is
 * stored, so it streams like anything else — routing every office extension through the
 * buffered path would hold a whole selection of real documents in memory for a check
 * the resolver settles on the first few magic bytes. Metadata without a type falls back
 * to the extension: better to resolve and pass through than to stream source text under
 * a document name.
 */
function needsRendering(file: WorkspaceFileRecord): boolean {
  return file.type ? GENERATED_SOURCE_TYPES.has(file.type) : isRenderableDocumentName(file.name)
}

/**
 * A `Readable` that opens its storage read on first pull rather than up front. The
 * archiver works through entries sequentially, so handing it an open stream per entry
 * would hold a connection per selected file — more than the storage client pools — with
 * most sitting idle until their turn. The generator body does not run until the first
 * read, and a failure to open surfaces as the stream's `error` event.
 */
function lazyWorkspaceFileStream(file: WorkspaceFileRecord): Readable {
  return Readable.from(
    (async function* () {
      yield* await downloadFileStream({
        key: file.key,
        context: file.storageContext ?? 'workspace',
      })
    })(),
    // `Readable.from` defaults to object mode; these are bytes headed for an archive.
    { objectMode: false }
  )
}

function selectionTooLargeResponse(bytes: number): NextResponse {
  return NextResponse.json(
    {
      error: `Selected files total ${formatFileSize(bytes)}, which exceeds the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit.`,
    },
    { status: 400 }
  )
}

/**
 * The rendered archive would exceed the limit even though the declared sizes did not —
 * generated documents render to more than the source they declared, so no accurate byte
 * count exists to quote here.
 */
function archiveTooLargeResponse(): NextResponse {
  return NextResponse.json(
    {
      error: `The selected files exceed the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit once documents are rendered. Select fewer files.`,
    },
    { status: 400 }
  )
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

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(downloadWorkspaceFileItemsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { fileIds, folderIds } = parsed.data.query

    const permission = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const [files, folders] = await Promise.all([
        listWorkspaceFiles(workspaceId, { hydrateFolderPaths: false }),
        listWorkspaceFileFolders(workspaceId),
      ])
      const folderPaths = buildWorkspaceFileFolderPathMap(folders)
      const selectedFolderIds = collectDescendantFolderIds(folderIds, folders)
      const requestedFileIds = new Set(fileIds)
      const filesToZip = files.filter(
        (file) =>
          requestedFileIds.has(file.id) || (file.folderId && selectedFolderIds.has(file.folderId))
      )

      if (filesToZip.length === 0) {
        return NextResponse.json({ error: 'No files selected for download' }, { status: 400 })
      }

      if (filesToZip.length > MAX_ZIP_DOWNLOAD_FILES) {
        return NextResponse.json(
          {
            error: `Too many files selected for download. Select ${MAX_ZIP_DOWNLOAD_FILES} or fewer files.`,
          },
          { status: 400 }
        )
      }

      const declaredBytes = filesToZip.reduce((sum, file) => sum + file.size, 0)
      if (declaredBytes > MAX_ZIP_DOWNLOAD_BYTES) {
        return selectionTooLargeResponse(declaredBytes)
      }

      // Streamed entries ship exactly what they declared, so their share of the budget is
      // known up front and is reserved here. Documents then draw from what is left —
      // one budget across both kinds, or the archive could ship two full limits' worth.
      const reservedForStreamed = filesToZip
        .filter((file) => !needsRendering(file))
        .reduce((sum, file) => sum + file.size, 0)

      // Generated documents are resolved before the archive starts: once the first byte
      // is written the status code is committed, so anything that can still fail the
      // request has to fail here. Their buffers are held until the archive is assembled,
      // bounded by what is left of the request's byte budget.
      const renderedDocuments = new Map<string, Buffer>()
      const pendingNames: string[] = []
      let renderedBytes = 0

      for (const file of filesToZip) {
        if (!needsRendering(file)) continue

        const remaining = Math.max(0, MAX_ZIP_DOWNLOAD_BYTES - reservedForStreamed - renderedBytes)
        // A source's declared size says nothing about what it renders to, so the cap is
        // the per-document ceiling, bounded by what is left of the budget.
        const allowance = Math.min(remaining, MAX_RENDERED_DOCUMENT_BYTES)

        try {
          const { buffer } = await fetchServableWorkspaceFileBuffer(file, { maxBytes: allowance })
          renderedBytes += buffer.length
          renderedDocuments.set(file.id, buffer)
        } catch (error) {
          if (error instanceof PayloadSizeLimitError) {
            // Blamed on the entry when its own ceiling was the binding cap; otherwise the
            // documents ahead of it have consumed the budget.
            return allowance === MAX_RENDERED_DOCUMENT_BYTES
              ? NextResponse.json(
                  {
                    error: `"${file.name}" renders to more than ${formatFileSize(MAX_RENDERED_DOCUMENT_BYTES)} and is too large to include in a zip; download it on its own instead.`,
                  },
                  { status: 400 }
                )
              : archiveTooLargeResponse()
          }
          // Pending artifacts are collected so the 409 can name all of them; anything
          // else dooms the request and waiting cannot fix it.
          if (!isDocNotReadyError(error)) throw error
          pendingNames.push(file.name)
        }
      }

      if (pendingNames.length > 0) {
        return NextResponse.json({ error: docNotReadyMessage(pendingNames) }, { status: 409 })
      }

      // Entry paths stay workspace-root-relative so a mixed selection of folders and
      // loose files keeps the layout the user sees in the files list.
      const entryPaths = buildZipEntryPaths(
        filesToZip.map((file) => ({
          name: file.name,
          folderPath: file.folderId ? folderPaths.get(file.folderId) : null,
        }))
      )

      // Ordinary files are never materialized: each entry opens its storage read only
      // when the archiver reaches it, so one entry is resident rather than the archive.
      const archive = new ZipArchive({ store: true })
      archive.on('warning', (error: Error) => {
        logger.warn('Archive warning while streaming workspace files', { error })
      })

      filesToZip.forEach((file, index) => {
        const rendered = renderedDocuments.get(file.id)
        archive.append(rendered ?? lazyWorkspaceFileStream(file), { name: entryPaths[index] })
      })
      void archive.finalize()

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        description: `Downloaded ${filesToZip.length} file${filesToZip.length === 1 ? '' : 's'} as zip`,
        metadata: { fileCount: filesToZip.length, totalBytes: declaredBytes },
        request,
      })
      captureServerEvent(
        session.user.id,
        'file_downloaded',
        { workspace_id: workspaceId, is_bulk: true, file_count: filesToZip.length },
        { groups: { workspace: workspaceId } }
      )

      // No Content-Length: the archive size is not known until it has been produced.
      return new NextResponse(nodeReadableToWebStream(archive), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="workspace-files.zip"',
          'Cache-Control': 'no-store',
        },
      })
    } catch (error) {
      logger.error('Failed to download workspace file selection:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
