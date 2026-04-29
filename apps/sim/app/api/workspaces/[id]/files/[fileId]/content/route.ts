import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  updateWorkspaceFileContentBodySchema,
  workspaceFileParamsSchema,
} from '@/lib/api/contracts/workspace-files'
import { getValidationErrorMessage } from '@/lib/api/server'
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

      const bodyResult = updateWorkspaceFileContentBodySchema.safeParse(
        await request.json().catch(() => ({}))
      )
      if (!bodyResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(bodyResult.error, 'Content must be a string') },
          { status: 400 }
        )
      }
      const { content } = bodyResult.data

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
