import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { FolderSubtreeRow } from '@/lib/folders/subtree'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  buildWorkspaceFileFolderPathMap,
  fetchWorkspaceFileBuffer,
  listWorkspaceFileFolders,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('WorkspaceFilesDownloadAPI')
const MAX_ZIP_DOWNLOAD_FILES = 100
const MAX_ZIP_DOWNLOAD_BYTES = 250 * 1024 * 1024

function safeZipPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      const cleaned = segment.trim().replace(/[<>:"\\|?*\x00-\x1f]/g, '_')
      return cleaned === '.' || cleaned === '..' ? '_' : cleaned
    })
    .filter(Boolean)
    .join('/')
}

function withZipPathSuffix(path: string, suffix: number): string {
  const slashIndex = path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? `${path.slice(0, slashIndex + 1)}` : ''
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
  const dotIndex = filename.lastIndexOf('.')

  return dotIndex > 0
    ? `${directory}${filename.slice(0, dotIndex)} (${suffix})${filename.slice(dotIndex)}`
    : `${directory}${filename} (${suffix})`
}

/**
 * Unions each root folder id with every descendant reachable from it.
 * Builds the parent→children index once and reuses it across all roots,
 * instead of rebuilding it per root as a per-root `collectDescendantFolderIds`
 * call would.
 */
function collectSelectedFolderIds(rootIds: string[], folders: FolderSubtreeRow[]): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId) ?? []
    children.push(folder.id)
    childrenByParent.set(folder.parentId, children)
  }

  const folderIds = new Set(rootIds)
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) ?? []) {
      if (folderIds.has(childId)) continue
      folderIds.add(childId)
      visit(childId)
    }
  }
  for (const rootId of rootIds) {
    visit(rootId)
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
      const selectedFolderIds = collectSelectedFolderIds(folderIds, folders)
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

      const buffers = await Promise.all(filesToZip.map((file) => fetchWorkspaceFileBuffer(file)))

      // Assemble zip synchronously so path deduplication is deterministic.
      const zip = new JSZip()
      const usedPaths = new Set<string>()
      for (let i = 0; i < filesToZip.length; i++) {
        const file = filesToZip[i]
        const buffer = buffers[i]
        const folderPath = file.folderId ? folderPaths.get(file.folderId) : null
        const basePath =
          safeZipPath(folderPath ? `${folderPath}/${file.name}` : file.name) ||
          safeZipPath(file.name) ||
          file.id
        let zipPath = basePath
        let suffix = 2
        while (usedPaths.has(zipPath)) {
          zipPath = withZipPathSuffix(basePath, suffix)
          suffix++
        }
        usedPaths.add(zipPath)
        zip.file(zipPath, buffer)
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        description: `Downloaded ${filesToZip.length} file${filesToZip.length === 1 ? '' : 's'} as zip`,
        metadata: { fileCount: filesToZip.length, totalBytes },
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
