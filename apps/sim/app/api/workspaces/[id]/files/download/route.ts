import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  buildWorkspaceFileFolderPathMap,
  listWorkspaceFileFolders,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WorkspaceFilesDownloadAPI')
const MAX_ZIP_DOWNLOAD_FILES = 100
const MAX_ZIP_DOWNLOAD_BYTES = 250 * 1024 * 1024

/** Shape `downloadServableFileFromStorage` needs to locate and label the stored object. */
function toServableInput(file: WorkspaceFileRecord): UserFile {
  return {
    id: file.id,
    name: file.name,
    url: file.path,
    size: file.size,
    type: file.type,
    key: file.key,
    context: 'workspace',
  }
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

      const totalBytes = filesToZip.reduce((sum, file) => sum + file.size, 0)
      if (totalBytes > MAX_ZIP_DOWNLOAD_BYTES) {
        return NextResponse.json(
          {
            error: `Selected files total ${formatFileSize(totalBytes)}, which exceeds the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit.`,
          },
          { status: 400 }
        )
      }

      // Generated docs (docx/pptx/pdf/xlsx) store their generation source, not the
      // rendered binary, so the bytes must be resolved through the shared servable
      // helper — a raw read ships source text under a `.docx` name.
      const requestId = generateRequestId()
      const downloads = await mapWithConcurrency(
        filesToZip,
        MATERIALIZE_CONCURRENCY,
        async (file) => {
          try {
            const servable = await downloadServableFileFromStorage(
              toServableInput(file),
              requestId,
              logger,
              { maxBytes: MAX_ZIP_DOWNLOAD_BYTES }
            )
            return { ok: true as const, buffer: servable.buffer }
          } catch (error) {
            return { ok: false as const, file, error }
          }
        }
      )

      const pending = downloads.filter(
        (result) => !result.ok && result.error instanceof DocCompileUserError
      )
      if (pending.length > 0) {
        const names = pending.map((result) => (result.ok ? '' : result.file.name))
        return NextResponse.json(
          {
            error: `${pending.length} document${pending.length === 1 ? ' is' : 's are'} still being generated: ${names.join(', ')}. Wait for them to finish, then try again.`,
          },
          { status: 409 }
        )
      }

      // Any other failure is a real storage error: fail the request rather than
      // handing back an archive with a file silently missing or empty.
      const buffers = downloads.map((result) => {
        if (!result.ok) throw result.error
        return result.buffer
      })

      // The pre-download cap used declared source sizes; generated docs resolve larger.
      const resolvedBytes = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
      if (resolvedBytes > MAX_ZIP_DOWNLOAD_BYTES) {
        return NextResponse.json(
          {
            error: `Selected files total ${formatFileSize(resolvedBytes)} once documents are rendered, which exceeds the ${formatFileSize(MAX_ZIP_DOWNLOAD_BYTES)} download limit.`,
          },
          { status: 400 }
        )
      }

      // Entry paths stay workspace-root-relative so a mixed selection of folders and
      // loose files keeps the layout the user sees in the files list.
      const entryPaths = buildZipEntryPaths(
        filesToZip.map((file) => ({
          name: file.name,
          folderPath: file.folderId ? folderPaths.get(file.folderId) : null,
        }))
      )

      const zip = new JSZip()
      for (const [index, buffer] of buffers.entries()) {
        zip.file(entryPaths[index], buffer)
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        description: `Downloaded ${filesToZip.length} file${filesToZip.length === 1 ? '' : 's'} as zip`,
        metadata: { fileCount: filesToZip.length, totalBytes: resolvedBytes },
        request,
      })
      captureServerEvent(
        session.user.id,
        'file_downloaded',
        { workspace_id: workspaceId, is_bulk: true, file_count: filesToZip.length },
        { groups: { workspace: workspaceId } }
      )

      return new NextResponse(new Uint8Array(zipBuffer), {
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
