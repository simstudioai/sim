import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
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
