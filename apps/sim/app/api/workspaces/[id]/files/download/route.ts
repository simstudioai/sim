import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  buildWorkspaceFileFolderPathMap,
  fetchServableWorkspaceFileBuffer,
  listWorkspaceFileFolders,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace'
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
 * Reads in flight cannot see each other's bytes until they land, so peak memory
 * scales with this. Kept well below the shared default: the entries here are whole
 * files held in memory at once, not rows.
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
      // read ships source text under a `.docx` name. The rendered artifact can be far
      // larger than the declared source size, so each read is capped at whatever is
      // left of the budget, with office extensions additionally held to their declared
      // size plus render headroom. Concurrent reads cannot see each other's bytes until
      // they land, so that per-entry allowance and the concurrency limit are together
      // what bound peak memory. Once the budget is blown or a read hard-fails, the
      // abort flag stops reads that have not started yet.
      const controller = new AbortController()
      let renderedBytes = 0
      let overLimit = false

      const downloads = await mapWithConcurrency(
        filesToZip,
        ZIP_MATERIALIZE_CONCURRENCY,
        async (file) => {
          if (controller.signal.aborted) return { buffer: null, pendingName: null, error: null }
          const remaining = Math.max(0, MAX_ZIP_DOWNLOAD_BYTES - renderedBytes)
          try {
            const allowance = isRenderableDocumentName(file.name)
              ? Math.max(file.size, RENDERED_DOCUMENT_HEADROOM_BYTES)
              : remaining
            const { buffer } = await fetchServableWorkspaceFileBuffer(file, {
              maxBytes: Math.min(remaining, allowance),
              signal: controller.signal,
            })
            renderedBytes += buffer.length
            if (renderedBytes > MAX_ZIP_DOWNLOAD_BYTES) {
              overLimit = true
              controller.abort()
            }
            return { buffer, pendingName: null, error: null }
          } catch (error) {
            // Recorded even when another worker already aborted: a size rejection
            // describes this file, so losing it to someone else's cancellation would
            // downgrade an actionable 400 into an opaque 500.
            if (error instanceof PayloadSizeLimitError) {
              overLimit = true
              controller.abort()
              return { buffer: null, pendingName: null, error: null }
            }
            // Any other error from an already-aborted read is a consequence of the
            // cancellation, not a cause. Checked before this worker aborts anything so
            // the worker that actually failed still records its own error.
            if (controller.signal.aborted) {
              return { buffer: null, pendingName: null, error: null }
            }
            // A pending artifact is worth reporting in full, so keep resolving the
            // rest of the selection; anything else dooms the request.
            const pending = isDocNotReadyError(error)
            if (!pending) controller.abort()
            return { buffer: null, pendingName: pending ? file.name : null, error }
          }
        }
      )

      // Size first: the request cannot succeed at any size-adjacent retry, and a
      // descriptive 400 beats an opaque 500 raised by whatever the abort cancelled.
      if (overLimit || renderedBytes > MAX_ZIP_DOWNLOAD_BYTES) {
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

      // Indexed off `downloads` so entries stay aligned with `filesToZip` by construction.
      const zip = new JSZip()
      downloads.forEach((result, index) => {
        if (result.buffer) zip.file(entryPaths[index], result.buffer)
      })

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        description: `Downloaded ${filesToZip.length} file${filesToZip.length === 1 ? '' : 's'} as zip`,
        metadata: { fileCount: filesToZip.length, totalBytes: renderedBytes },
        request,
      })
      captureServerEvent(
        session.user.id,
        'file_downloaded',
        { workspace_id: workspaceId, is_bulk: true, file_count: filesToZip.length },
        { groups: { workspace: workspaceId } }
      )

      return new NextResponse(
        // View, not copy — a 250 MB archive would otherwise cost 500 MB. Node buffers
        // are never backed by a SharedArrayBuffer, so the narrowing is sound.
        new Uint8Array(zipBuffer.buffer as ArrayBuffer, zipBuffer.byteOffset, zipBuffer.byteLength),
        {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="workspace-files.zip"',
            'Cache-Control': 'no-store',
          },
        }
      )
    } catch (error) {
      logger.error('Failed to download workspace file selection:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
