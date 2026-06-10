import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { exportWorkspaceFilesToDriveContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadBufferToDrive } from '@/lib/google-drive/upload-to-drive'
import { fetchWorkspaceFileBuffer, listWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const GOOGLE_DRIVE_PROVIDER_ID = 'google-drive'

const logger = createLogger('WorkspaceFilesExportToDriveAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const parsed = await parseRequest(exportWorkspaceFilesToDriveContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { fileIds, credentialId } = parsed.data.body

    const permission = await verifyWorkspaceMembership(userId, workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, userId, requestId)
    if (!accessToken) {
      logger.warn(`[${requestId}] Could not resolve Google Drive access token`, { credentialId })
      return NextResponse.json(
        { error: 'Google Drive account is not connected or its access has expired' },
        { status: 400 }
      )
    }

    const allFiles = await listWorkspaceFiles(workspaceId, { hydrateFolderPaths: false })
    const fileById = new Map(allFiles.map((file) => [file.id, file]))
    const filesToExport = fileIds
      .map((id) => fileById.get(id))
      .filter((file): file is NonNullable<typeof file> => file !== undefined)

    if (filesToExport.length === 0) {
      return NextResponse.json({ error: 'No matching files found to export' }, { status: 400 })
    }

    const exported: Array<{
      fileId: string
      name: string
      driveFileId: string
      webViewLink?: string
    }> = []
    // Requested ids that no longer exist (e.g. deleted between selection and export)
    // are reported as failures so the client never shows a false full-success.
    const failed: Array<{ fileId: string; name?: string; error: string }> = fileIds
      .filter((id) => !fileById.has(id))
      .map((id) => ({ fileId: id, error: 'File not found' }))

    for (const file of filesToExport) {
      try {
        const buffer = await fetchWorkspaceFileBuffer(file)
        const driveFile = await uploadBufferToDrive({
          accessToken,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          buffer,
        })
        exported.push({
          fileId: file.id,
          name: file.name,
          driveFileId: driveFile.id,
          webViewLink: driveFile.webViewLink,
        })
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to export file')
        logger.error(`[${requestId}] Failed to export file to Google Drive`, {
          fileId: file.id,
          name: file.name,
          error: message,
        })
        failed.push({ fileId: file.id, name: file.name, error: message })
      }
    }

    logger.info(`[${requestId}] Export to Google Drive complete`, {
      provider: GOOGLE_DRIVE_PROVIDER_ID,
      workspaceId,
      exported: exported.length,
      failed: failed.length,
    })

    return NextResponse.json({
      success: failed.length === 0,
      exported,
      failed,
    })
  }
)
