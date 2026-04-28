import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { updateWorkspaceFileContent } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileContentAPI')

/**
 * PUT /api/workspaces/[id]/files/[fileId]/content
 * Update a workspace file's text content (requires write permission)
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()
    const { id: workspaceId, fileId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (userPermission !== 'admin' && userPermission !== 'write') {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const body = await request.json()
      const { content } = body as { content: string }

      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'Content must be a string' }, { status: 400 })
      }

      const buffer = Buffer.from(content, 'utf-8')

      const maxFileSizeBytes = 50 * 1024 * 1024
      if (buffer.length > maxFileSizeBytes) {
        return NextResponse.json(
          { error: `File size exceeds ${maxFileSizeBytes / 1024 / 1024}MB limit` },
          { status: 413 }
        )
      }

      const updatedFile = await updateWorkspaceFileContent(
        workspaceId,
        fileId,
        session.user.id,
        buffer
      )

      logger.info(`[${requestId}] Updated content for workspace file: ${updatedFile.name}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FILE_UPDATED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: updatedFile.name,
        description: `Updated content of file "${updatedFile.name}"`,
        metadata: { contentSize: buffer.length },
        request,
      })

      return NextResponse.json({
        success: true,
        file: updatedFile,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update file content'
      const isNotFound = errorMessage.includes('File not found')
      const isQuotaExceeded = errorMessage.includes('Storage limit exceeded')
      const status = isNotFound ? 404 : isQuotaExceeded ? 402 : 500

      if (status === 500) {
        logger.error(`[${requestId}] Error updating file content:`, error)
      } else {
        logger.warn(`[${requestId}] ${errorMessage}`)
      }

      return NextResponse.json({ success: false, error: errorMessage }, { status })
    }
  }
)
