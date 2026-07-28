import { PassThrough, type Readable } from 'stream'
import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ZipArchive } from 'archiver'
import lazystream from 'lazystream'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
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
import { formatFileSize, isRenderableDocumentName } from '@/lib/uploads/utils/file-utils'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/servable-file-response'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('WorkspaceFilesDownloadAPI')
const MAX_ZIP_DOWNLOAD_FILES = 100
const MAX_ZIP_DOWNLOAD_BYTES = 250 * 1024 * 1024
/**
 * Headroom a document may render to beyond what it declared. Office extensions
 * cover both ordinary uploads — which serve exactly their declared size — and
 * source-backed generated docs, and the two are indistinguishable before the bytes
 * are read. So the allowance is the larger of the declared size and this ceiling:
 * an uploaded 80 MiB deck still downloads, while a 6 KiB generator source cannot
 * quietly render into hundreds of megabytes.
 */
const RENDERED_DOCUMENT_HEADROOM_BYTES = 50 * 1024 * 1024
/**
 * Fan-out for files that serve exactly their declared size. Their total is already
 * bounded by the pre-download check, so concurrency cannot push residency past it.
 * Renderable documents are read one at a time instead — see below.
 */
const ZIP_MATERIALIZE_CONCURRENCY = 5

function overLimitResponse(bytes: number, qualifier = ''): NextResponse {
  return NextResponse.json(
    {
      error: `Selected files total ${formatFileSize(bytes)}${qualifier}, which exceeds the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit.`,
    },
    { status: 400 }
  )
}

/**
 * A `Readable` that opens its storage read on first pull rather than up front. Handing
 * the archiver one open stream per entry would hold a connection per selected file —
 * more than the storage client pools — with most sitting idle until their turn.
 */
function lazyWorkspaceFileStream(file: WorkspaceFileRecord): Readable {
  return new lazystream.Readable(() => {
    const relay = new PassThrough()
    downloadFileStream({ key: file.key, context: file.storageContext ?? 'workspace' })
      .then((source) => {
        source.on('error', (error) => relay.destroy(toError(error)))
        source.pipe(relay)
      })
      .catch((error) => relay.destroy(toError(error)))
    return relay
  })
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
        return overLimitResponse(declaredBytes)
      }

      // Generated docs (docx/pptx/pdf/xlsx) store their generation source, not the
      // rendered binary, so bytes are resolved through the servable reader — a raw
      // read ships source text under a `.docx` name.
      //
      // Only those documents can exceed the size they declared, so only they can push
      // residency past the budget the pre-download check already enforced. They are
      // therefore read one at a time, which keeps the overshoot to a single entry;
      // everything else stays parallel because its bytes are exactly its declared size.
      // Once the budget is blown or a read hard-fails, the abort flag stops reads that
      // have not started yet.
      const controller = new AbortController()
      let renderedBytes = 0

      interface DownloadOutcome {
        buffer: Buffer | null
        pendingName: string | null
        /** Set only when an entry's own allowance bound it, never the shared budget. */
        overLimitEntry: { name: string; allowance: number } | null
        overLimit: boolean
        error: unknown
      }
      const skipped: DownloadOutcome = {
        buffer: null,
        pendingName: null,
        overLimitEntry: null,
        overLimit: false,
        error: null,
      }

      const readEntry = async (file: WorkspaceFileRecord): Promise<DownloadOutcome> => {
        if (controller.signal.aborted) return skipped
        const remaining = Math.max(0, MAX_ZIP_DOWNLOAD_BYTES - renderedBytes)
        // Uploads and source-backed documents are indistinguishable before the bytes
        // are read, so the allowance is the larger of the declared size and the render
        // headroom: a real 80 MiB deck still downloads, a small generator source cannot
        // render unbounded.
        const allowance = Math.max(file.size, RENDERED_DOCUMENT_HEADROOM_BYTES)
        try {
          const { buffer } = await fetchServableWorkspaceFileBuffer(file, {
            maxBytes: Math.min(remaining, allowance),
            signal: controller.signal,
          })
          renderedBytes += buffer.length
          const overLimit = renderedBytes > MAX_ZIP_DOWNLOAD_BYTES
          if (overLimit) controller.abort()
          return { ...skipped, buffer, overLimit }
        } catch (error) {
          // Recorded even when another worker already aborted: a size rejection
          // describes this file, so losing it to someone else's cancellation would
          // downgrade an actionable 400 into an opaque 500.
          if (error instanceof PayloadSizeLimitError) {
            controller.abort()
            // Attributed to this entry when its own cap was the binding one — ties
            // included, since the entry's ceiling still made it unshippable and
            // downloading it alone is the way through. Otherwise the budget ran out.
            return {
              ...skipped,
              overLimit: true,
              overLimitEntry: allowance <= remaining ? { name: file.name, allowance } : null,
            }
          }
          // Any other error from an already-aborted read is a consequence of the
          // cancellation, not a cause. Checked before this worker aborts anything so
          // the worker that actually failed still records its own error.
          if (controller.signal.aborted) return skipped
          // A pending artifact is worth reporting in full, so keep resolving the
          // rest of the selection; anything else dooms the request.
          const pending = isDocNotReadyError(error)
          if (!pending) controller.abort()
          return { ...skipped, pendingName: pending ? file.name : null, error }
        }
      }

      // Documents are resolved up front, one at a time: they are the only entries that
      // need their bytes in hand, and every status this route can return is decided
      // from them. Nothing may fail after the first byte is written — the status code
      // is committed by then — so this has to happen before the archive starts.
      const documentBuffers = new Map<string, Buffer>()
      const documents = filesToZip.filter((file) => isRenderableDocumentName(file.name))
      const downloads = await mapWithConcurrency(documents, 1, (file) => readEntry(file))
      downloads.forEach((outcome, index) => {
        if (outcome.buffer) documentBuffers.set(documents[index].id, outcome.buffer)
      })

      // Size first: the request cannot succeed at any size-adjacent retry, and a
      // descriptive 400 beats an opaque 500 raised by whatever the abort cancelled.
      const overLimitEntry = downloads.find((result) => result.overLimitEntry)?.overLimitEntry
      if (overLimitEntry) {
        // Naming the entry that blew its own allowance, and quoting the allowance that
        // actually applied: an aggregate message here would tell the user to select
        // fewer files when the selection was fine.
        return NextResponse.json(
          {
            error: `"${overLimitEntry.name}" is too large to include in a zip. Entries are capped at ${formatFileSize(overLimitEntry.allowance)}; download it on its own instead.`,
          },
          { status: 400 }
        )
      }

      if (downloads.some((result) => result.overLimit)) {
        return overLimitResponse(renderedBytes, ' once documents are rendered')
      }

      // A hard failure outranks a pending artifact: waiting cannot fix it, so a 409
      // would send the client into a retry loop that never succeeds.
      const failure = downloads.find((result) => result.error && !result.pendingName)
      if (failure?.error) throw failure.error

      const pendingNames = downloads.flatMap((result) => result.pendingName ?? [])
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
      // when the archiver reaches it (`lazystream` defers the factory until first read),
      // so peak memory is one entry rather than the whole selection. Resolved documents
      // are appended from the buffers above.
      const archive = new ZipArchive({ store: true })
      archive.on('warning', (error: Error) => {
        logger.warn('Archive warning while streaming workspace files', { error })
      })

      filesToZip.forEach((file, index) => {
        const buffer = documentBuffers.get(file.id)
        archive.append(buffer ?? lazyWorkspaceFileStream(file), { name: entryPaths[index] })
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
