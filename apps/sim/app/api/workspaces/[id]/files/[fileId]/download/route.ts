import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workspaceFileParamsSchema } from '@/lib/api/contracts/workspace-files'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileDownloadAPI')

/**
 * POST /api/workspaces/[id]/files/[fileId]/download
 * Return authenticated file serve URL (requires read permission)
 * Uses /api/files/serve endpoint which enforces authentication and context
 */
export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()
    const paramsResult = workspaceFileParamsSchema.safeParse(await params)
    if (!paramsResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
        { status: 400 }
      )
    }
    const { id: workspaceId, fileId } = paramsResult.data

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
      if (!userPermission) {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const fileRecord = await getWorkspaceFile(workspaceId, fileId)
      if (!fileRecord) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const { getBaseUrl } = await import('@/lib/core/utils/urls')
      const serveUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(fileRecord.key)}?context=workspace`
      const viewerUrl = `${getBaseUrl()}/workspace/${workspaceId}/files/${fileId}`

      logger.info(`[${requestId}] Generated download URL for workspace file: ${fileRecord.name}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: fileRecord.name,
        description: `Downloaded file "${fileRecord.name}"`,
        metadata: { fileId, fileName: fileRecord.name, bytes: fileRecord.size },
        request,
      })
      captureServerEvent(
        session.user.id,
        'file_downloaded',
        { workspace_id: workspaceId, is_bulk: false, file_count: 1 },
        { groups: { workspace: workspaceId } }
      )

      return NextResponse.json({
        success: true,
        downloadUrl: serveUrl,
        viewerUrl: viewerUrl,
        fileName: fileRecord.name,
        expiresIn: null,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error generating download URL:`, error)
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(error, 'Failed to generate download URL'),
        },
        { status: 500 }
      )
    }
  }
)
